import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  const key = req.headers['x-a305-secret']
  const expected = process.env.DASHBOARD_PASSWORD || process.env.WEBHOOK_SECRET
  if (!expected || key !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store')

  const brandSlug = req.query.brand || null

  try {
    const today = new Date().toISOString().split('T')[0]
    const monthStart = today.slice(0, 7) + '-01'

    let brandFilter = null
    if (brandSlug) {
      const { data: brand } = await supabase
        .from('brands')
        .select('id')
        .eq('slug', brandSlug)
        .single()
      if (brand) brandFilter = brand.id
    }

    const [
      brands,
      pipeline,
      mailboxes,
      queueData,
      holdQueue,
      recent,
      contactsCount,
      sentTodayCount,
      killSwitch,
      aiSpend,
      warmingMailboxes,
      healthScores,
    ] = await Promise.all([
      supabase.from('brands').select('*').order('slug'),
      supabase.from('pipeline_summary').select('*'),
      fetchMailboxes(brandFilter),
      fetchQueue(brandFilter),
      fetchHoldQueue(brandFilter),
      fetchRecent(brandFilter),
      countContacts(),
      countSentToday(today, brandFilter),
      supabase.from('global_settings').select('value').eq('key', 'kill_switch').single(),
      fetchAISpend(monthStart, brandFilter),
      fetchWarmingMailboxes(brandFilter),
      fetchLatestHealthScores(brandFilter),
    ])

    const firstErr = [brands, pipeline, mailboxes].find(r => r.error)?.error
    if (firstErr) throw firstErr

    const pipelineRows = (pipeline.data || [])
      .filter(r => !brandSlug || r.brand === brandSlug)

    const kpis = {
      contacts: contactsCount,
      active: sum(pipelineRows, 'active'),
      completed: sum(pipelineRows, 'completed'),
      replied: sum(pipelineRows, 'replied'),
      unsubscribed: sum(pipelineRows, 'unsubscribed'),
      bounced: sum(pipelineRows, 'bounced'),
      queue_today: (queueData.data || []).length,
      hold_queue: (holdQueue.data || []).length,
      sent_today: sentTodayCount,
      kill_switch: killSwitch.data?.value === true,
    }

    const mailboxList = (mailboxes.data || []).map(m => ({
      id: m.id,
      address: m.address,
      display_name: m.display_name,
      brand_slug: m.brands?.slug,
      status: m.status,
      send_mode: m.send_mode,
      sends_today: m.sends_today,
      daily_cap: m.daily_cap,
      health_score: m.health_score,
      warmup_started_at: m.warmup_started_at,
      active: m.active,
    }))

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      brand_filter: brandSlug,
      brands: (brands.data || []).map(b => ({ slug: b.slug, display_name: b.display_name, domain: b.domain, provider: b.provider })),
      kpis,
      pipeline: pipelineRows,
      mailboxes: mailboxList,
      queue: (queueData.data || []).slice(0, 100).map(formatQueueItem),
      hold_queue: (holdQueue.data || []).map(formatHoldItem),
      recent: (recent.data || []).map(formatRecent),
      ai_spend: aiSpend,
      warming: (warmingMailboxes.data || []).map(formatWarming),
      health_scores: healthScores,
    })
  } catch (err) {
    console.error('dashboard error:', err)
    return res.status(500).json({ error: err.message })
  }
}

async function fetchMailboxes(brandId) {
  let q = supabase
    .from('mailboxes')
    .select('*, brands (slug)')
    .order('address')
  if (brandId) q = q.eq('brand_id', brandId)
  return q
}

async function fetchQueue(brandId) {
  let q = supabase
    .from('send_queue')
    .select('id, step_number, scheduled_at, status, contacts (email, first_name, company, practice_name), brands (slug)')
    .in('status', ['PENDING', 'SENDING'])
    .order('scheduled_at')
    .limit(100)
  if (brandId) q = q.eq('brand_id', brandId)
  return q
}

async function fetchHoldQueue(brandId) {
  let q = supabase
    .from('send_queue')
    .select('id, step_number, subject, hold_reason, hold_expires_at, contacts (email, first_name, company, practice_name), brands (slug)')
    .eq('status', 'HELD')
    .order('created_at', { ascending: false })
    .limit(50)
  if (brandId) q = q.eq('brand_id', brandId)
  return q
}

async function fetchRecent(brandId) {
  let q = supabase
    .from('send_log')
    .select('step, status, subject, sent_at, message_id, contacts (email, first_name, company, practice_name), mailboxes (address), brands (slug)')
    .order('sent_at', { ascending: false })
    .limit(25)
  if (brandId) q = q.eq('brand_id', brandId)
  return q
}

async function countContacts() {
  const { count } = await supabase.from('contacts').select('id', { count: 'exact', head: true })
  return count || 0
}

async function countSentToday(today, brandId) {
  let q = supabase.from('send_log').select('id', { count: 'exact', head: true })
    .gte('sent_at', today).eq('status', 'sent')
  if (brandId) q = q.eq('brand_id', brandId)
  const { count } = await q
  return count || 0
}

async function fetchAISpend(monthStart, brandId) {
  let q = supabase.from('ai_cost_log')
    .select('brand_id, model, task_type, estimated_cost_usd')
    .gte('created_at', monthStart)
  if (brandId) q = q.eq('brand_id', brandId)
  const { data } = await q

  if (!data || data.length === 0) return { total: 0, by_brand: {}, by_task: {} }

  const total = data.reduce((s, r) => s + Number(r.estimated_cost_usd), 0)
  const byBrand = {}
  const byTask = {}
  for (const r of data) {
    byBrand[r.brand_id] = (byBrand[r.brand_id] || 0) + Number(r.estimated_cost_usd)
    byTask[r.task_type] = (byTask[r.task_type] || 0) + Number(r.estimated_cost_usd)
  }

  const { data: budgetRow } = await supabase
    .from('global_settings')
    .select('value')
    .eq('key', 'monthly_ai_budget_usd')
    .single()

  return {
    total: Math.round(total * 100) / 100,
    budget: budgetRow?.value || 50,
    remaining: Math.round(((budgetRow?.value || 50) - total) * 100) / 100,
    by_brand: byBrand,
    by_task: byTask,
  }
}

async function fetchWarmingMailboxes(brandId) {
  let q = supabase
    .from('mailboxes')
    .select('id, address, status, warmup_started_at, health_score, daily_cap, sends_today, send_mode, brands (slug)')
    .in('status', ['WARMING', 'BLOCKED'])
  if (brandId) q = q.eq('brand_id', brandId)
  return q
}

async function fetchLatestHealthScores(brandId) {
  let q = supabase
    .from('health_score_history')
    .select('*, mailboxes (address, brands (slug))')
    .order('computed_at', { ascending: false })
    .limit(20)
  if (brandId) {
    const { data: mbs } = await supabase.from('mailboxes').select('id').eq('brand_id', brandId)
    if (mbs) q = q.in('mailbox_id', mbs.map(m => m.id))
  }
  const { data } = await q
  return (data || []).map(h => ({
    address: h.mailboxes?.address,
    brand: h.mailboxes?.brands?.slug,
    total_score: h.total_score,
    inbox_placement_pts: h.inbox_placement_pts,
    bounce_rate_pct: h.bounce_rate_pct,
    bounce_rate_pts: h.bounce_rate_pts,
    complaint_rate_pct: h.complaint_rate_pct,
    complaint_rate_pts: h.complaint_rate_pts,
    postmaster_rep: h.postmaster_rep,
    postmaster_pts: h.postmaster_pts,
    reply_rate_pct: h.reply_rate_pct,
    reply_rate_pts: h.reply_rate_pts,
    hard_gate_failed: h.hard_gate_failed,
    hard_gate_reason: h.hard_gate_reason,
    seed_test_missing: h.seed_test_missing,
    computed_at: h.computed_at,
  }))
}

function formatQueueItem(q) {
  return {
    id: q.id,
    email: q.contacts?.email,
    name: q.contacts?.first_name,
    org: q.contacts?.company || q.contacts?.practice_name,
    step: q.step_number,
    scheduled_at: q.scheduled_at,
    brand: q.brands?.slug,
  }
}

function formatHoldItem(h) {
  return {
    id: h.id,
    email: h.contacts?.email,
    name: h.contacts?.first_name,
    org: h.contacts?.company || h.contacts?.practice_name,
    step: h.step_number,
    subject: h.subject,
    hold_reason: h.hold_reason,
    expires_at: h.hold_expires_at,
    brand: h.brands?.slug,
  }
}

function formatRecent(r) {
  return {
    step: r.step,
    status: r.status,
    subject: r.subject,
    sent_at: r.sent_at,
    contact: r.contacts?.email,
    name: r.contacts?.first_name,
    org: r.contacts?.company || r.contacts?.practice_name,
    mailbox: r.mailboxes?.address,
    brand: r.brands?.slug,
  }
}

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + Number(r[key] || 0), 0)
}
