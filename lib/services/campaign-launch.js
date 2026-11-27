import { createDefaultResolver, evaluateBlocklist } from './domain-auth.js'

// Aesthetic (aestheticdevicepro.com) starts with the weekday cron on
// Monday 23 Nov 2026. automate305.com stays off while it is listed, and
// the global flag is still required before that campaign can send.
export const AESTHETIC_AUTOMATION_START = '2026-11-23'

export function easternDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}

export function campaignAutomationEnabled(campaign, environment = process.env, now = new Date()) {
  if (environment.CAMPAIGN_AUTOMATION_ENABLED === 'true') return true

  return campaign === 'aesthetic' && easternDate(now) >= AESTHETIC_AUTOMATION_START
}

export function surblSendBlock(blocklistResult) {
  const surbl = (blocklistResult?.lists || []).find((entry) => entry.list === 'SURBL multi')

  if (surbl?.outcome === 'listed') {
    return { blocked: true, reason: `SURBL listed: ${surbl.reason}`, warning: null }
  }

  if (!surbl || surbl.outcome === 'unavailable' || surbl.outcome === 'error' || surbl.outcome === 'unknown') {
    return {
      blocked: false,
      reason: null,
      warning: surbl?.reason || 'SURBL could not be checked'
    }
  }

  return { blocked: false, reason: null, warning: null }
}

export function domainsForCampaign(senders, campaign) {
  return [...new Set(
    (senders || [])
      .filter((sender) => sender.campaign === campaign)
      .map((sender) => String(sender.email || '').split('@')[1]?.trim().toLowerCase())
      .filter(Boolean)
  )]
}

export async function campaignBlockedBySurbl(campaign, senders, {
  environment = process.env,
  evaluate = evaluateBlocklist,
  now = () => new Date(),
  resolver = createDefaultResolver()
} = {}) {
  const clock = typeof now === 'function' ? now : () => now
  const domains = domainsForCampaign(senders, campaign)

  if (domains.length === 0) {
    return { blocked: true, reason: 'No sending domain for this campaign', warnings: [] }
  }

  const blocks = []
  const warnings = []

  for (const domain of domains) {
    const report = await evaluate(domain, null, { environment, now: clock, resolver })
    const decision = surblSendBlock(report)

    if (decision.blocked) blocks.push(`${domain}: ${decision.reason}`)
    else if (decision.warning) warnings.push(`${domain}: ${decision.warning}`)
  }

  if (blocks.length === 0) return { blocked: false, reason: null, warnings }

  return { blocked: true, reason: blocks.join('; '), warnings }
}
