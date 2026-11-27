import { createClient } from '@supabase/supabase-js'

import { campaignAutomationEnabled, campaignBlockedBySurbl } from '../../../lib/services/campaign-launch.js'
import { outboxRunRecord, recordOutboxRun, resetSendsForEasternDay } from '../../../lib/services/outbox-run-log.js'
import { syncProspectReplies } from '../../../lib/services/reply-sync.js'
import { isUsableEnvironmentValue } from '../../../lib/services/smtp.js'

// The cron calls this same deployment. The host comes from Vercel or from
// WEBHOOK_URL, never from the request, so a forged Host header cannot
// steer the readiness or send fetch.
export function cronSelfOrigin(environment = process.env) {
  const vercelHost = String(environment.VERCEL_URL || '').trim()
  if (/^[a-z0-9.-]+$/i.test(vercelHost) && vercelHost.includes('.')) {
    return `https://${vercelHost}`
  }

  if (!isUsableEnvironmentValue(environment.WEBHOOK_URL)) return null
  try {
    const url = new URL(environment.WEBHOOK_URL)
    if (url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

function countsFrom(body) {
  const results = body?.results || {}
  const campaignResults = body?.campaignResults || []
  const sent = campaignResults.reduce((total, entry) => total + (entry.result?.results?.sent?.length || 0), results.sent?.length || 0)
  const failed = campaignResults.reduce((total, entry) => total + (entry.result?.results?.failed?.length || 0), results.failed?.length || 0)
  const skipped = campaignResults.reduce((total, entry) => total + (entry.result?.results?.skipped?.length || 0), results.skipped?.length || 0)
  return {
    blocked: body?.blockedCampaigns?.length || 0,
    failed,
    sent,
    skipped
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  async function finish(supabase, statusCode, body, meta) {
    await recordOutboxRun(supabase, outboxRunRecord({
      campaign: meta.campaign ?? null,
      counts: meta.counts || countsFrom(body),
      details: body,
      job: 'daily-send',
      status: meta.status,
      stopReason: meta.stopReason ?? null
    }))
    return res.status(statusCode).json(body)
  }

  if (req.method !== 'GET') {
    return finish(null, 405, { error: 'Method not allowed' }, {
      status: 'error',
      stopReason: 'Method not allowed'
    })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!isUsableEnvironmentValue(cronSecret) || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return finish(null, 401, { error: 'Unauthorized' }, {
      status: 'error',
      stopReason: 'Unauthorized'
    })
  }

  const webhookSecret = process.env.WEBHOOK_SECRET
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  const origin = cronSelfOrigin()
  if (!origin || !isUsableEnvironmentValue(webhookSecret) ||
      !isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return finish(null, 503, { error: 'Sending automation is not fully configured.' }, {
      status: 'error',
      stopReason: 'Sending automation is not fully configured.'
    })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  try {
    // Reset before every gate. A failed SURBL, inbox, or readiness check
    // must not leave yesterday's sends_today in place. The reset is keyed
    // on the America/New_York date, so a later run today does not zero
    // mail that already went out.
    const reset = await resetSendsForEasternDay(supabase, { allowLegacyRpc: true })
    if (!reset.ok) {
      return finish(supabase, 503, { error: 'Unable to reset daily sender counts.', reset }, {
        status: 'error',
        stopReason: reset.error || 'Unable to reset daily sender counts.'
      })
    }

    const { data: queuedItems, error: queueError } = await supabase
      .from('todays_queue')
      .select('campaign')
    if (queueError) {
      return finish(supabase, 503, { error: 'Unable to load today\'s queue.' }, {
        status: 'error',
        stopReason: 'Unable to load today\'s queue.'
      })
    }

    const queuedCampaigns = [...new Set((queuedItems || []).map((item) => item.campaign).filter(Boolean))]
    if (queuedCampaigns.length === 0) {
      return finish(supabase, 200, {
        message: 'Nothing in queue today',
        reset,
        results: { sent: [], failed: [], skipped: [] }
      }, {
        status: 'ok',
        stopReason: 'Nothing in queue today'
      })
    }

    const { data: senders, error: senderError } = await supabase
      .from('senders')
      .select('campaign,email')
    if (senderError) {
      return finish(supabase, 503, { error: 'Unable to load sending domains.' }, {
        status: 'error',
        stopReason: 'Unable to load sending domains.'
      })
    }

    const allowedCampaigns = []
    const blockedCampaigns = []
    const blocklistWarnings = []
    for (const campaign of queuedCampaigns) {
      if (!campaignAutomationEnabled(campaign)) {
        blockedCampaigns.push({ campaign, reason: 'Campaign automation is off' })
        continue
      }

      const listing = await campaignBlockedBySurbl(campaign, senders)
      if (listing.warnings?.length) {
        blocklistWarnings.push({ campaign, warnings: listing.warnings })
      }
      if (listing.blocked) {
        blockedCampaigns.push({ campaign, reason: listing.reason })
        continue
      }

      allowedCampaigns.push(campaign)
    }

    if (allowedCampaigns.length === 0) {
      return finish(supabase, 200, {
        blockedCampaigns,
        blocklistWarnings,
        message: 'No campaign is allowed to send.',
        reset,
        results: { sent: [], failed: [], skipped: [] }
      }, {
        status: 'stopped',
        stopReason: 'No campaign is allowed to send.'
      })
    }

    let replySync
    try {
      replySync = await syncProspectReplies(supabase, { campaigns: allowedCampaigns })
    } catch (error) {
      return finish(supabase, 503, {
        blocklistWarnings,
        error: error.message || 'Reply check failed. No email was sent.'
      }, {
        status: 'error',
        stopReason: error.message || 'Reply check failed. No email was sent.'
      })
    }

    const replyBlocked = new Set(replySync.blockedCampaigns || [])
    const replyCleared = []
    for (const campaign of allowedCampaigns) {
      if (replyBlocked.has(campaign)) {
        blockedCampaigns.push({ campaign, reason: 'Reply inbox could not be read' })
        continue
      }
      replyCleared.push(campaign)
    }

    if (replyCleared.length === 0) {
      return finish(supabase, 503, {
        blockedCampaigns,
        blocklistWarnings,
        error: 'Reply inboxes could not be read for the campaigns that were otherwise allowed to send.',
        replySync
      }, {
        status: 'error',
        stopReason: 'Reply inbox could not be read'
      })
    }

    const readyCampaigns = []
    for (const campaign of replyCleared) {
      const readinessResponse = await fetch(`${origin}/api/readiness?campaign=${encodeURIComponent(campaign)}`, {
        headers: { 'x-a305-secret': webhookSecret },
        method: 'GET'
      })
      const readiness = await readinessResponse.json()
      if (readinessResponse.ok && readiness.ready) readyCampaigns.push(campaign)
      else blockedCampaigns.push({ campaign, readiness })
    }

    if (readyCampaigns.length === 0) {
      return finish(supabase, 503, {
        blockedCampaigns,
        blocklistWarnings,
        error: 'No queued campaign passed SMTP readiness.',
        replySync
      }, {
        status: 'error',
        stopReason: 'No queued campaign passed SMTP readiness.'
      })
    }

    const campaignResults = []
    for (const campaign of readyCampaigns) {
      const sendResponse = await fetch(`${origin}/api/send?campaign=${encodeURIComponent(campaign)}`, {
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json', 'x-a305-secret': webhookSecret },
        method: 'POST'
      })
      campaignResults.push({ campaign, result: await sendResponse.json(), status: sendResponse.status })
    }

    const anySent = campaignResults.some((entry) => (entry.result?.results?.sent?.length || 0) > 0)
    return finish(supabase, 200, {
      blockedCampaigns,
      blocklistWarnings,
      campaignResults,
      replySync,
      reset
    }, {
      status: anySent ? 'ok' : 'stopped',
      stopReason: anySent ? null : 'No email was sent.'
    })
  } catch (error) {
    return finish(supabase, 500, {
      error: error.message || 'Daily send failed before any email was sent.'
    }, {
      status: 'error',
      stopReason: error.message || 'Daily send failed before any email was sent.'
    })
  }
}
