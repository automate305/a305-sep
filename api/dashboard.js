// ============================================================
// Automate305 SEP · /api/dashboard.js
// Read-only aggregate data for the operator dashboard (public/dashboard.html).
//
// GET /api/dashboard   header: x-a305-secret: <DASHBOARD_PASSWORD or WEBHOOK_SECRET>
//
// All Supabase access is server-side with the service key; the browser only
// ever receives aggregated JSON — no secrets, no service key, no raw tables
// beyond what's shown. Auth reuses WEBHOOK_SECRET unless DASHBOARD_PASSWORD is
// set (recommended, so the sending secret never lands in a browser).
// ============================================================

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

  try {
    const today = new Date().toISOString().split('T')[0]

    const [
      pipeline,
      senders,
      queue,
      recent,
      contactsCount,
      sentTodayCount
    ] = await Promise.all([
      supabase.from('pipeline_summary').select('*'),
      supabase.from('senders')
        .select('email,name,campaign,sends_today,daily_limit,active,warmed')
        .order('campaign', { ascending: true })
        .order('email', { ascending: true }),
      supabase.from('todays_queue')
        .select('email,first_name,company,practice_name,sequence_name,campaign,step')
        .limit(100),
      supabase.from('send_log')
        .select('step,status,subject,sent_at,contacts(email,first_name,company,practice_name),senders(email,name)')
        .order('sent_at', { ascending: false })
        .limit(25),
      supabase.from('contacts').select('id', { count: 'exact', head: true }),
      supabase.from('send_log').select('id', { count: 'exact', head: true })
        .gte('sent_at', today).eq('status', 'sent')
    ])

    // Surface the first hard error if any core query failed
    const firstErr = [pipeline, senders, queue, recent].find(r => r.error)?.error
    if (firstErr) throw firstErr

    const pipelineRows = pipeline.data || []
    const kpis = {
      contacts:        contactsCount.count || 0,
      active:          sum(pipelineRows, 'active'),
      completed:       sum(pipelineRows, 'completed'),
      replied:         sum(pipelineRows, 'replied'),
      unsubscribed:    sum(pipelineRows, 'unsubscribed'),
      bounced:         sum(pipelineRows, 'bounced'),
      queue_today:     (queue.data || []).length,
      sent_today:      sentTodayCount.count || 0
    }

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      kpis,
      pipeline: pipelineRows,
      senders:  senders.data || [],
      queue:    queue.data || [],
      recent:   (recent.data || []).map(r => ({
        step:    r.step,
        status:  r.status,
        subject: r.subject,
        sent_at: r.sent_at,
        contact: r.contacts?.email || null,
        name:    r.contacts?.first_name || null,
        org:     r.contacts?.company || r.contacts?.practice_name || null,
        sender:  r.senders?.email || null
      }))
    })
  } catch (err) {
    console.error('dashboard error:', err)
    return res.status(500).json({ error: err.message })
  }
}

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + Number(r[key] || 0), 0)
}
