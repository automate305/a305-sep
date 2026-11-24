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

  if (!surbl || surbl.outcome === 'unavailable' || surbl.outcome === 'error') {
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
  evaluate = evaluateBlocklist,
  now = new Date(),
  resolver = createDefaultResolver()
} = {}) {
  const domains = domainsForCampaign(senders, campaign)

  if (domains.length === 0) {
    return { blocked: true, reason: 'No sending domain for this campaign' }
  }

  const blocks = []

  for (const domain of domains) {
    const report = await evaluate(domain, null, { now, resolver })
    const decision = surblSendBlock(report)

    if (decision.warning) {
      console.warn(`SURBL check did not complete for ${domain}: ${decision.warning}`)
    }
    if (decision.blocked) blocks.push(`${domain}: ${decision.reason}`)
  }

  if (blocks.length === 0) return { blocked: false, reason: null }

  return { blocked: true, reason: blocks.join('; ') }
}
