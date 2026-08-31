import { supabase } from './supabase.js'
import { checkDns } from './dns-gate.js'
import { getProvider } from './providers/index.js'

export async function computeHealthScore(mailbox, brand) {
  const provider = getProvider(brand.provider)
  const dnsResult = await checkDns(brand, provider)

  const trailingDays7 = new Date(Date.now() - 7 * 86400000).toISOString()
  const trailingDays14 = new Date(Date.now() - 14 * 86400000).toISOString()

  const [sendStats, bounceStats, complaintCount, replyCount] = await Promise.all([
    supabase.from('send_log')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .gte('sent_at', trailingDays14)
      .eq('status', 'sent'),
    supabase.from('send_log')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .gte('sent_at', trailingDays7)
      .in('status', ['bounced']),
    supabase.from('inbound_messages')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .gte('received_at', trailingDays14)
      .in('classification', ['UNSUBSCRIBE']),
    supabase.from('inbound_messages')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailbox.id)
      .gte('received_at', trailingDays14)
      .eq('classification', 'REPLY'),
  ])

  const totalSent14d = sendStats.count || 0
  const hardBounces7d = bounceStats.count || 0
  const complaints14d = complaintCount.count || 0
  const replies14d = replyCount.count || 0

  const bounceRate7d = totalSent14d > 0 ? (hardBounces7d / totalSent14d) : 0
  const bounceRate14d = bounceRate7d
  const complaintRate = totalSent14d > 0 ? (complaints14d / totalSent14d) : 0
  const replyRate = totalSent14d > 0 ? (replies14d / totalSent14d) : 0

  let hardGateFailed = false
  let hardGateReason = null

  if (!dnsResult.results.spf.pass || !dnsResult.results.dkim.pass || !dnsResult.results.dmarc.pass) {
    hardGateFailed = true
    const failing = []
    if (!dnsResult.results.spf.pass) failing.push('SPF')
    if (!dnsResult.results.dkim.pass) failing.push('DKIM')
    if (!dnsResult.results.dmarc.pass) failing.push('DMARC')
    hardGateReason = `Auth failing: ${failing.join(', ')}`
  }

  if (!dnsResult.results.blacklist.pass) {
    hardGateFailed = true
    hardGateReason = (hardGateReason ? hardGateReason + '; ' : '') + 'Domain/IP on blacklist'
  }

  if (bounceRate7d > 0.05) {
    hardGateFailed = true
    hardGateReason = (hardGateReason ? hardGateReason + '; ' : '') +
      `Hard bounce rate ${(bounceRate7d * 100).toFixed(1)}% exceeds 5% threshold`
  }

  if (hardGateFailed) {
    const record = {
      mailbox_id: mailbox.id,
      total_score: 0,
      hard_gate_failed: true,
      hard_gate_reason: hardGateReason,
      bounce_rate_pct: bounceRate14d * 100,
      complaint_rate_pct: complaintRate * 100,
      reply_rate_pct: replyRate * 100,
      seed_test_missing: true,
    }
    await saveScore(mailbox.id, record)
    return record
  }

  const { data: seedTest } = await supabase
    .from('health_score_history')
    .select('inbox_placement_pct, computed_at')
    .eq('mailbox_id', mailbox.id)
    .not('inbox_placement_pct', 'is', null)
    .order('computed_at', { ascending: false })
    .limit(1)

  let inboxPlacementPct = null
  let inboxPlacementPts = null
  let seedTestMissing = true

  if (seedTest && seedTest.length > 0) {
    seedTestMissing = false
    inboxPlacementPct = seedTest[0].inbox_placement_pct
    const ageWeeks = (Date.now() - new Date(seedTest[0].computed_at).getTime()) / (7 * 86400000)
    const decay = Math.max(0, Math.floor(ageWeeks - 1)) * 5
    inboxPlacementPts = Math.max(0, (inboxPlacementPct / 100) * 40 - decay)
  }

  let bouncePts
  if (bounceRate14d < 0.01) bouncePts = 20
  else if (bounceRate14d < 0.02) bouncePts = 12
  else bouncePts = 5

  let complaintPts
  if (complaintRate < 0.001) complaintPts = 20
  else if (complaintRate < 0.003) complaintPts = 10
  else complaintPts = 0

  const postmasterRep = dnsResult.results.postmaster.verified ? null : 'no_data'
  let postmasterPts
  if (postmasterRep === 'no_data') postmasterPts = 5
  else if (postmasterRep === 'High') postmasterPts = 10
  else if (postmasterRep === 'Medium') postmasterPts = 6
  else postmasterPts = 0

  let replyPts
  if (replyRate >= 0.05) replyPts = 10
  else if (replyRate >= 0.02) replyPts = 7
  else if (replyRate >= 0.01) replyPts = 4
  else replyPts = 0

  let totalScore = bouncePts + complaintPts + postmasterPts + replyPts
  if (inboxPlacementPts !== null) {
    totalScore += inboxPlacementPts
  } else {
    totalScore = Math.min(totalScore, 60)
  }

  const record = {
    mailbox_id: mailbox.id,
    total_score: Math.round(totalScore),
    inbox_placement_pct: inboxPlacementPct,
    inbox_placement_pts: inboxPlacementPts !== null ? Math.round(inboxPlacementPts * 10) / 10 : null,
    bounce_rate_pct: Math.round(bounceRate14d * 10000) / 100,
    bounce_rate_pts: bouncePts,
    complaint_rate_pct: Math.round(complaintRate * 10000) / 100,
    complaint_rate_pts: complaintPts,
    postmaster_rep: postmasterRep,
    postmaster_pts: postmasterPts,
    reply_rate_pct: Math.round(replyRate * 10000) / 100,
    reply_rate_pts: replyPts,
    hard_gate_failed: false,
    seed_test_missing: seedTestMissing,
  }

  await saveScore(mailbox.id, record)
  return record
}

async function saveScore(mailboxId, record) {
  await supabase.from('health_score_history').insert(record)
  await supabase
    .from('mailboxes')
    .update({
      health_score: record.total_score,
      last_scored_at: new Date().toISOString()
    })
    .eq('id', mailboxId)
}

export async function computeAllScores() {
  const { data: mailboxes } = await supabase
    .from('mailboxes')
    .select('id, address, brand_id, status')
    .eq('active', true)

  if (!mailboxes) return []

  const brandCache = {}
  const results = []

  for (const mb of mailboxes) {
    if (!brandCache[mb.brand_id]) {
      const { data: brand } = await supabase
        .from('brands')
        .select('*')
        .eq('id', mb.brand_id)
        .single()
      brandCache[mb.brand_id] = brand
    }

    const score = await computeHealthScore(mb, brandCache[mb.brand_id])
    results.push({ address: mb.address, ...score })
  }

  return results
}
