import { createClient } from '@supabase/supabase-js'

import { createSenderGate } from '../../lib/services/sender-gate.js'
import { isUsableEnvironmentValue } from '../../lib/services/smtp.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const configuredWebhookSecret = process.env.WEBHOOK_SECRET
  const providedWebhookSecret = req.headers['x-a305-secret']

  if (!isUsableEnvironmentValue(configuredWebhookSecret) ||
      providedWebhookSecret !== configuredWebhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

  if (!isUsableEnvironmentValue(supabaseUrl) ||
      !isUsableEnvironmentValue(supabaseServiceKey)) {
    return res.status(503).json({
      checkedAt: new Date().toISOString(),
      error: 'Supabase is not configured',
      ready: false
    })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  const campaign = typeof req.query.campaign === 'string' ? req.query.campaign.trim() : ''
  if (campaign && !/^[a-z0-9_]+$/.test(campaign)) {
    return res.status(400).json({ error: 'Invalid campaign filter' })
  }

  let senderQuery = supabase
    .from('senders')
    .select('email,name,campaign,host,port,daily_limit,sends_today,warmed,active')
    .eq('active', true)
    .gt('daily_limit', 0)
    .order('campaign')
    .order('email')

  if (campaign) senderQuery = senderQuery.eq('campaign', campaign)
  const { data: activeSenders, error: senderError } = await senderQuery

  if (senderError) {
    return res.status(503).json({
      checkedAt: new Date().toISOString(),
      error: 'Unable to load active senders',
      ready: false
    })
  }

  // Reported by the same gate that decides the send path, so readiness
  // can never say yes to a mailbox the send path would refuse.
  const gate = createSenderGate()

  const senderResults = await Promise.all((activeSenders || []).map(async (sender) => {
    const verdict = await gate.inspectSender(sender)

    return {
      // Readiness asks "permitted", not "sendable": the daily counters
      // are reset after this check, so today's remaining budget is not
      // a readiness question.
      blockedBy: verdict.permittedBlockedBy,
      campaign: verdict.campaign,
      credentialConfigured: verdict.credentialConfigured,
      email: verdict.email,
      error: verdict.error,
      permitted: verdict.permitted,
      provider: verdict.provider,
      smtpAuthenticated: verdict.smtpAuthenticated,
      warmed: verdict.warmed
    }
  }))

  const ready = senderResults.length > 0 && senderResults.every(
    (sender) => sender.permitted
  )

  return res.status(ready ? 200 : 503).json({
    checkedAt: new Date().toISOString(),
    ready,
    senders: senderResults,
    summary: {
      authenticated: senderResults.filter((sender) => sender.smtpAuthenticated).length,
      configured: senderResults.filter((sender) => sender.credentialConfigured).length,
      total: senderResults.length,
      warmed: senderResults.filter((sender) => sender.warmed).length
    }
  })
}
