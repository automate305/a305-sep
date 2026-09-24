import nodemailer from 'nodemailer'

const SMTP_PROVIDER_BY_DOMAIN = {
  'aestheticdevicepro.com': {
    host: 'smtp.hostinger.com',
    port: 465,
    provider: 'hostinger',
    secure: true
  },
  'automate305.com': {
    host: 'smtp.gmail.com',
    port: 465,
    provider: 'google-workspace',
    secure: true
  }
}

const PLACEHOLDER_PATTERNS = [
  /^your-/i,
  /-here$/i,
  /your-project-id/i
]

function normalizedEnvironmentValue(value) {
  return String(value || '')
    .trim()
    .replace(/^(["'`])(.*)\1$/, '$2')
    .trim()
}

export function isUsableEnvironmentValue(value) {
  const normalizedValue = normalizedEnvironmentValue(value)

  return Boolean(normalizedValue) && !PLACEHOLDER_PATTERNS.some(
    (placeholderPattern) => placeholderPattern.test(normalizedValue)
  )
}

export function getSmtpPasswordEnvironmentVariable(email) {
  const mailboxName = email.split('@')[0]
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')

  return `SMTP_PASS_${mailboxName}`
}

export function getSmtpTransportSettings(sender) {
  const senderDomain = sender.email.split('@')[1]?.toLowerCase()
  const configuredProvider = SMTP_PROVIDER_BY_DOMAIN[senderDomain]
  const port = configuredProvider?.port || sender.port || 465

  return {
    host: configuredProvider?.host || sender.host || 'smtp.hostinger.com',
    port,
    provider: configuredProvider?.provider || 'custom',
    secure: configuredProvider?.secure ?? port === 465
  }
}

export function senderHasCapacity(sender) {
  const dailyLimit = Number(sender.daily_limit || 0)
  const sendsToday = Number(sender.sends_today || 0)

  return dailyLimit > 0 && sendsToday < dailyLimit
}

// NOTE: the composite "may this sender send?" decision deliberately does
// not live here. It lives in lib/services/sender-gate.js, which is the
// one guard every send route calls. This module stays the low-level
// SMTP toolkit the gate is built from.

export function createSmtpTransporter(sender, environment = process.env) {
  const passwordEnvironmentVariable = getSmtpPasswordEnvironmentVariable(sender.email)
  const password = environment[passwordEnvironmentVariable]

  if (!isUsableEnvironmentValue(password)) {
    const credentialError = new Error(
      `Missing usable SMTP credential: ${passwordEnvironmentVariable}`
    )
    credentialError.code = 'SMTP_CREDENTIAL_MISSING'
    throw credentialError
  }

  const transportSettings = getSmtpTransportSettings(sender)

  return nodemailer.createTransport({
    host: transportSettings.host,
    port: transportSettings.port,
    secure: transportSettings.secure,
    auth: {
      user: sender.email,
      pass: password
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  })
}

export function getSmtpVerificationError(error) {
  const errorCode = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : 'SMTP_VERIFY_FAILED'

  if (errorCode === 'EAUTH') {
    return { code: errorCode, message: 'SMTP authentication failed' }
  }

  if (errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKET') {
    return { code: errorCode, message: 'SMTP connection timed out' }
  }

  if (errorCode === 'SMTP_CREDENTIAL_MISSING') {
    return { code: errorCode, message: 'SMTP credential is missing or still a placeholder' }
  }

  return { code: errorCode, message: 'SMTP verification failed' }
}

export async function verifySmtpSender(sender, environment = process.env) {
  const transporter = createSmtpTransporter(sender, environment)

  try {
    await transporter.verify()
  } finally {
    transporter.close()
  }
}
