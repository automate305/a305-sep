import { normalizeEmail } from './suppression.js'

const OWN_DOMAINS = new Set(['aestheticdevicepro.com', 'automate305.com'])

export function imapHostForSmtpHost(smtpHost) {
  if (smtpHost === 'smtp.gmail.com') return 'imap.gmail.com'
  if (smtpHost === 'smtp.hostinger.com') return 'imap.hostinger.com'

  return null
}

export function isProspectReply(from, { seeds = new Set() } = {}) {
  const email = normalizeEmail(from)

  if (!email || !email.includes('@')) return false

  const domain = email.split('@')[1]

  if (OWN_DOMAINS.has(domain)) return false
  if (seeds.has(email)) return false
  if (email.startsWith('mailer-daemon@') || email.startsWith('postmaster@')) return false

  return true
}

export function seedRecipients(environment = process.env) {
  return new Set(
    String(environment.WARMUP_SEED_RECIPIENTS || '')
      .split(',')
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  )
}
