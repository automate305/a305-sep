// ============================================================
// Automate305 SEP · lib/services/sender-gate.js
//
// The single server-side guard that decides whether a mailbox is
// allowed to send. Every send route goes through it, so there is one
// place — not one per route — that answers "may this sender send?".
//
// A sender passes only when it is active, warmed, inside its daily
// limit, has a usable SMTP credential, and authenticates against its
// provider. When no sender passes, the refusal names each blocked
// mailbox and the reason, so an operator can see which mailbox is
// still warming rather than a bare "no sender available".
// ============================================================

import {
  getSmtpPasswordEnvironmentVariable,
  getSmtpTransportSettings,
  getSmtpVerificationError,
  isUsableEnvironmentValue,
  senderHasCapacity,
  verifySmtpSender
} from './smtp.js'

export const SENDER_BLOCK_CODES = {
  CREDENTIAL_MISSING: 'SMTP_CREDENTIAL_MISSING',
  DAILY_LIMIT_REACHED: 'SENDER_DAILY_LIMIT_REACHED',
  INACTIVE: 'SENDER_INACTIVE',
  NOT_WARMED: 'SENDER_NOT_WARMED'
}

export const NO_ELIGIBLE_SENDER = 'NO_ELIGIBLE_SENDER'

// ── STATIC CHECKS ────────────────────────────────────────────
// Everything that can be decided without touching the network, split
// into two questions the routes ask separately:
//
//   permitted — is this mailbox allowed to send at all?
//               (active, warmed, credentialed) · asked by /api/readiness
//   capacity  — does it have room left today?
//               (sends_today < daily_limit) · asked by the send path
//
// They are separate because the daily cron checks readiness BEFORE it
// resets the day's counters, so a mailbox sitting at yesterday's limit
// must not read as unready and block its whole campaign.
//
// Checks are reported together, not short-circuited, so a mailbox that
// is both unwarmed and uncredentialed reports both.
export function describeSenderState(sender, environment = process.env) {
  const passwordEnvironmentVariable = getSmtpPasswordEnvironmentVariable(sender.email)
  const credentialConfigured = isUsableEnvironmentValue(environment[passwordEnvironmentVariable])
  const hasCapacity = senderHasCapacity(sender)
  const blockedBy = []

  if (!sender.active) {
    blockedBy.push({
      code: SENDER_BLOCK_CODES.INACTIVE,
      message: `${sender.email} is not active`
    })
  }

  if (!sender.warmed) {
    blockedBy.push({
      code: SENDER_BLOCK_CODES.NOT_WARMED,
      message: `${sender.email} is not warmed`
    })
  }

  if (!credentialConfigured) {
    blockedBy.push({
      code: SENDER_BLOCK_CODES.CREDENTIAL_MISSING,
      message: `${sender.email} has no usable ${passwordEnvironmentVariable}`
    })
  }

  const capacityBlock = hasCapacity ? [] : [{
    code: SENDER_BLOCK_CODES.DAILY_LIMIT_REACHED,
    message: `${sender.email} has reached its daily limit ` +
      `(${Number(sender.sends_today || 0)}/${Number(sender.daily_limit || 0)})`
  }]

  return {
    blockedBy: [...blockedBy, ...capacityBlock],
    campaign: sender.campaign,
    credentialConfigured,
    email: sender.email,
    hasCapacity,
    // Permitted ignores the daily budget; sendable is permitted AND in budget.
    permittedBlockedBy: blockedBy,
    permittedStatically: blockedBy.length === 0,
    provider: getSmtpTransportSettings(sender).provider,
    sendableStatically: blockedBy.length === 0 && hasCapacity,
    warmed: Boolean(sender.warmed)
  }
}

export class SenderGateError extends Error {
  constructor(message, { blockedSenders = [], campaign = null } = {}) {
    super(message)
    this.name = 'SenderGateError'
    this.code = NO_ELIGIBLE_SENDER
    this.blockedSenders = blockedSenders
    this.campaign = campaign
  }
}

function describeCampaign(campaign) {
  return campaign ? `campaign "${campaign}"` : 'any campaign'
}

// ── THE GATE ─────────────────────────────────────────────────
// One gate per request. SMTP verification is memoised per mailbox so a
// queue of fifty emails opens one connection per sender, not fifty.
export function createSenderGate({
  environment = process.env,
  verifySender = verifySmtpSender
} = {}) {
  const smtpResultByEmail = new Map()

  async function verifyOnce(sender) {
    if (!smtpResultByEmail.has(sender.email)) {
      smtpResultByEmail.set(sender.email, (async () => {
        try {
          await verifySender(sender, environment)
          return { error: null, smtpAuthenticated: true }
        } catch (verificationError) {
          return {
            error: getSmtpVerificationError(verificationError),
            smtpAuthenticated: false
          }
        }
      })())
    }

    return smtpResultByEmail.get(sender.email)
  }

  // Full verdict for one sender, including the SMTP handshake.
  // Used by /api/readiness to report, and by selectSender to decide.
  //   permitted — allowed to send at all (ignores today's budget)
  //   sendable  — permitted AND has capacity left today
  async function inspectSender(sender) {
    const state = describeSenderState(sender, environment)

    if (!state.credentialConfigured) {
      return {
        ...state,
        error: {
          code: SENDER_BLOCK_CODES.CREDENTIAL_MISSING,
          message: 'SMTP credential is missing or still a placeholder'
        },
        permitted: false,
        sendable: false,
        smtpAuthenticated: false
      }
    }

    const verification = await verifyOnce(sender)
    const smtpBlock = verification.smtpAuthenticated ? [] : [{
      code: verification.error.code,
      message: `${sender.email}: ${verification.error.message}`
    }]
    const permitted = state.permittedStatically && verification.smtpAuthenticated

    return {
      ...state,
      blockedBy: [...state.blockedBy, ...smtpBlock],
      error: verification.error,
      permitted,
      permittedBlockedBy: [...state.permittedBlockedBy, ...smtpBlock],
      sendable: permitted && state.hasCapacity,
      smtpAuthenticated: verification.smtpAuthenticated
    }
  }

  // Picks the least-used sender that clears every check.
  // Throws a SenderGateError naming each blocked mailbox when none do.
  async function selectSender(senders, campaign = null) {
    const candidates = [...(senders || [])].sort(
      (left, right) => Number(left.sends_today || 0) - Number(right.sends_today || 0)
    )

    if (candidates.length === 0) {
      throw new SenderGateError(
        `No sender is configured for ${describeCampaign(campaign)}`,
        { campaign }
      )
    }

    const blockedSenders = []

    for (const candidate of candidates) {
      const staticState = describeSenderState(candidate, environment)

      // Never open an SMTP connection for a mailbox that is already
      // disqualified — an unwarmed mailbox stays untouched.
      if (!staticState.sendableStatically) {
        blockedSenders.push({
          ...staticState,
          permitted: false,
          sendable: false,
          smtpAuthenticated: null
        })
        continue
      }

      const verdict = await inspectSender(candidate)
      if (verdict.sendable) return candidate

      blockedSenders.push(verdict)
    }

    const reasons = blockedSenders
      .flatMap((blocked) => blocked.blockedBy.map((reason) => reason.message))
      .join('; ')

    throw new SenderGateError(
      `No sender passed the send gate for ${describeCampaign(campaign)}: ${reasons}`,
      { blockedSenders, campaign }
    )
  }

  return { inspectSender, selectSender }
}
