import {
  getSmtpTransportSettings,
  isUsableEnvironmentValue,
  resolveSmtpPassword
} from './smtp.js'
import { imapHostForSmtpHost, isProspectReply, seedRecipients } from './reply-match.js'
import { normalizeEmail } from './suppression.js'
import { stopContactForReply } from './stop-contact.js'

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
const MAX_MESSAGES = 200

export function mailboxesForSenders(senders, environment = process.env) {
  const mailboxes = []
  const seen = new Map()

  for (const sender of senders || []) {
    const settings = getSmtpTransportSettings(sender)
    const host = imapHostForSmtpHost(settings.host)

    if (!host) continue

    const resolved = resolveSmtpPassword(sender.email, environment)

    if (!isUsableEnvironmentValue(resolved.password)) continue

    const key = `${host}|${resolved.user}`

    if (seen.has(key)) {
      if (sender.campaign) seen.get(key).campaigns.add(sender.campaign)
      continue
    }

    const mailbox = {
      campaigns: new Set(sender.campaign ? [sender.campaign] : []),
      host,
      password: resolved.password,
      user: resolved.user
    }
    seen.set(key, mailbox)
    mailboxes.push(mailbox)
  }

  return mailboxes.map((mailbox) => ({
    ...mailbox,
    campaigns: [...mailbox.campaigns]
  }))
}

// A mailbox that cannot be read blocks only the campaigns that send from it.
// A campaign with no readable inbox is blocked. Other campaigns continue.
export function campaignsBlockedByReplyFailure(campaigns, mailboxes, errors) {
  const failed = new Set((errors || []).map((entry) => entry.mailbox))
  const blocked = []

  for (const campaign of campaigns || []) {
    const own = (mailboxes || []).filter((mailbox) => (mailbox.campaigns || []).includes(campaign))
    if (own.length === 0 || own.some((mailbox) => failed.has(mailbox.user))) blocked.push(campaign)
  }

  return blocked
}

export async function listRecentFromAddresses({ host, password, since, user }) {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    auth: { pass: password, user },
    host,
    logger: false,
    port: 993,
    secure: true
  })

  await client.connect()
  const messages = []

  try {
    const lock = await client.getMailboxLock('INBOX')

    try {
      const uids = await client.search({ since })
      const limited = Array.isArray(uids) ? uids.slice(-MAX_MESSAGES) : []

      if (limited.length > 0) {
        for await (const message of client.fetch(limited, { envelope: true }, { uid: true })) {
          const from = message.envelope?.from?.[0]?.address

          if (from) messages.push({ from })
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return messages
}

export async function syncProspectReplies(supabase, {
  campaigns = null,
  environment = process.env,
  listMessages = listRecentFromAddresses,
  now = new Date(),
  stopReply = stopContactForReply
} = {}) {
  const { data: senders, error } = await supabase
    .from('senders')
    .select('email,host,campaign')

  if (error) throw new Error('Sender lookup failed. No email was sent.')

  const scopedSenders = campaigns
    ? (senders || []).filter((sender) => campaigns.includes(sender.campaign))
    : senders
  const mailboxes = mailboxesForSenders(scopedSenders, environment)
  const seeds = seedRecipients(environment)
  const since = new Date(now.getTime() - LOOKBACK_MS)
  const errors = []
  const fromAddresses = new Set()

  for (const mailbox of mailboxes) {
    try {
      const messages = await listMessages({ ...mailbox, since })

      for (const message of messages || []) {
        const from = normalizeEmail(message.from)

        if (isProspectReply(from, { seeds })) fromAddresses.add(from)
      }
    } catch {
      errors.push({ mailbox: mailbox.user, message: 'Inbox check failed' })
    }
  }

  const requestedCampaigns = campaigns || [
    ...new Set((scopedSenders || []).map((sender) => sender.campaign).filter(Boolean))
  ]
  const blockedCampaigns = campaignsBlockedByReplyFailure(requestedCampaigns, mailboxes, errors)
  const addresses = [...fromAddresses]
  let stopped = 0

  if (addresses.length > 0) {
    const { data: contacts, error: contactError } = await supabase
      .from('contacts')
      .select('email')
      .in('email', addresses)

    if (contactError) throw new Error('Reply contact lookup failed. No email was sent.')

    for (const contact of contacts || []) {
      const result = await stopReply(
        supabase,
        contact.email,
        'Reply seen in a sending inbox. Sequence stopped.'
      )

      if (result.contact_found) stopped += 1
    }
  }

  return {
    blockedCampaigns,
    errors,
    mailboxes: mailboxes.length,
    matched: addresses.length,
    stopped
  }
}
