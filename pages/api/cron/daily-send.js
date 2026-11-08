import { createClient } from '@supabase/supabase-js'

import { isUsableEnvironmentValue } from '../../../lib/services/smtp.js'

const automationEnabled = () => process.env.CAMPAIGN_AUTOMATION_ENABLED === 'true'

function getRequestOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  return host ? `${protocol}://${host}` : null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!isUsableEnvironmentValue(cronSecret) || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!automationEnabled()) {
    return res.status(200).json({
      automation: 'disabled',
      message: 'Daily sending is intentionally disabled until launch readiness is approved.'
    })
  }

  const webhookSecret = process.env.WEBHOOK_SECRET
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  const origin = getRequestOrigin(req)
  if (!origin || !isUsableEnvironmentValue(webhookSecret) ||
      !isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return res.status(503).json({ error: 'Sending automation is not fully configured.' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: queuedItems, error: queueError } = await supabase
    .from('todays_queue')
    .select('campaign')
  if (queueError) return res.status(503).json({ error: 'Unable to load today\'s queue.' })

  const queuedCampaigns = [...new Set((queuedItems || []).map((item) => item.campaign).filter(Boolean))]
  if (queuedCampaigns.length === 0) {
    return res.status(200).json({ message: 'Nothing in queue today', results: { sent: [], failed: [], skipped: [] } })
  }

  const readyCampaigns = []
  const blockedCampaigns = []
  for (const campaign of queuedCampaigns) {
    const readinessResponse = await fetch(`${origin}/api/readiness?campaign=${encodeURIComponent(campaign)}`, {
      headers: { 'x-a305-secret': webhookSecret },
      method: 'GET'
    })
    const readiness = await readinessResponse.json()
    if (readinessResponse.ok && readiness.ready) readyCampaigns.push(campaign)
    else blockedCampaigns.push({ campaign, readiness })
  }

  if (readyCampaigns.length === 0) {
    return res.status(503).json({ error: 'No queued campaign passed SMTP readiness.', blockedCampaigns })
  }

  const { error: resetError } = await supabase.rpc('reset_daily_sends')
  if (resetError) return res.status(503).json({ error: 'Unable to reset daily sender counts.' })

  const campaignResults = []
  for (const campaign of readyCampaigns) {
    const sendResponse = await fetch(`${origin}/api/send?campaign=${encodeURIComponent(campaign)}`, {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json', 'x-a305-secret': webhookSecret },
      method: 'POST'
    })
    campaignResults.push({ campaign, result: await sendResponse.json(), status: sendResponse.status })
  }

  return res.status(200).json({ blockedCampaigns, campaignResults })
}
