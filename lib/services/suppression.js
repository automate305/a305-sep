// ============================================================
// Automate305 SEP · lib/services/suppression.js
//
// Unsubscribe links and the suppression write path.
//
// A link has to identify the recipient to a route that no one is logged
// into, so each one carries a signed token: the address plus an HMAC
// over it. Nothing is stored per link and a token cannot be guessed,
// edited to name someone else, or replayed against another mailbox.
//
// The write itself goes through the suppress_contact() Postgres
// function, so the suppression row, the contact flag and the enrollment
// stand-down commit together or not at all.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

import { isUsableEnvironmentValue } from './smtp.js'

export const SUPPRESSION_SOURCES = {
  BOUNCE: 'bounce',
  IMPORT: 'import',
  MANUAL: 'manual',
  ONE_CLICK: 'one-click',
  REPLY: 'reply'
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

// The signing key is its own secret when one is configured. Falling back
// to a key DERIVED from WEBHOOK_SECRET (never the secret itself) keeps
// unsubscribe links working before UNSUBSCRIBE_SECRET is set, without
// putting the send webhook's secret into a public URL.
export function getUnsubscribeSigningKey(environment = process.env) {
  if (isUsableEnvironmentValue(environment.UNSUBSCRIBE_SECRET)) {
    return String(environment.UNSUBSCRIBE_SECRET)
  }

  if (isUsableEnvironmentValue(environment.WEBHOOK_SECRET)) {
    return createHmac('sha256', String(environment.WEBHOOK_SECRET))
      .update('a305:unsubscribe:v1')
      .digest('hex')
  }

  return null
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function mintUnsubscribeToken(email, environment = process.env) {
  const signingKey = getUnsubscribeSigningKey(environment)

  if (!signingKey) {
    const configurationError = new Error(
      'Cannot sign unsubscribe links: set UNSUBSCRIBE_SECRET or WEBHOOK_SECRET'
    )
    configurationError.code = 'UNSUBSCRIBE_SECRET_MISSING'
    throw configurationError
  }

  const payload = base64UrlEncode(JSON.stringify({ e: normalizeEmail(email), v: 1 }))
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')

  return `${payload}.${signature}`
}

export function readUnsubscribeToken(token, environment = process.env) {
  const signingKey = getUnsubscribeSigningKey(environment)
  if (!signingKey) return { email: null, valid: false }

  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) return { email: null, valid: false }

  const expected = createHmac('sha256', signingKey).update(payload).digest('base64url')
  const providedBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)

  // Compare in constant time, and only when the lengths already match —
  // timingSafeEqual throws on a length mismatch.
  if (providedBytes.length !== expectedBytes.length) return { email: null, valid: false }
  if (!timingSafeEqual(providedBytes, expectedBytes)) return { email: null, valid: false }

  try {
    const decoded = JSON.parse(base64UrlDecode(payload))
    const email = normalizeEmail(decoded?.e)

    return email ? { email, valid: true } : { email: null, valid: false }
  } catch {
    return { email: null, valid: false }
  }
}

export function buildUnsubscribeUrl(email, origin, environment = process.env) {
  const token = mintUnsubscribeToken(email, environment)

  return `${String(origin).replace(/\/+$/, '')}/api/unsubscribe?token=${encodeURIComponent(token)}`
}

// ── THE WRITE ────────────────────────────────────────────────
// One RPC call, one transaction. Do not replace this with separate
// contacts / enrollments / suppressions updates: that is precisely the
// split that leaves someone suppressed in one table and mailable in
// another.
/**
 * @param {any} supabase
 * @param {{
 *   actor?: string | null,
 *   campaign?: string | null,
 *   email: string,
 *   reason: string,
 *   scope?: string,
 *   source?: string
 * }} options
 */
export async function suppressContact(supabase, {
  actor = null,
  campaign = null,
  email,
  reason,
  scope = 'global',
  source = SUPPRESSION_SOURCES.MANUAL
}) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    const validationError = new Error('An email address is required to suppress a contact')
    validationError.code = 'SUPPRESSION_EMAIL_REQUIRED'
    throw validationError
  }

  if (scope === 'campaign' && !campaign) {
    const validationError = new Error('A campaign-scoped suppression needs a campaign key')
    validationError.code = 'SUPPRESSION_CAMPAIGN_REQUIRED'
    throw validationError
  }

  const { data, error } = await supabase.rpc('suppress_contact', {
    actor,
    contact_email: normalizedEmail,
    suppression_campaign: scope === 'campaign' ? campaign : null,
    suppression_reason: reason,
    suppression_scope: scope,
    suppression_source: source
  })

  if (error) {
    const suppressionError = new Error(`Suppression failed: ${error.message}`)
    suppressionError.code = 'SUPPRESSION_WRITE_FAILED'
    throw suppressionError
  }

  return data
}

/**
 * @param {any} supabase
 * @param {{ campaign?: string | null, email: string, scope?: string }} options
 */
export async function reinstateContact(supabase, { campaign = null, email, scope = 'global' }) {
  const { data, error } = await supabase.rpc('reinstate_contact', {
    contact_email: normalizeEmail(email),
    reinstate_campaign: scope === 'campaign' ? campaign : null,
    reinstate_scope: scope
  })

  if (error) {
    const reinstateError = new Error(`Reinstate failed: ${error.message}`)
    reinstateError.code = 'REINSTATE_WRITE_FAILED'
    throw reinstateError
  }

  return data
}

// ── EXPORT / IMPORT ──────────────────────────────────────────
// A suppression list that cannot leave the system is not a suppression
// list. These two round-trip: parseSuppressionCsv(toSuppressionCsv(x))
// yields x.
const CSV_COLUMNS = ['value', 'match_type', 'scope', 'campaign', 'reason', 'source', 'created_at']

function escapeCsvField(value) {
  const stringValue = value === null || value === undefined ? '' : String(value)

  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue
}

export function toSuppressionCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')]

  for (const row of rows || []) {
    lines.push(CSV_COLUMNS.map((column) => escapeCsvField(row[column])).join(','))
  }

  return lines.join('\n')
}

function splitCsvLine(line) {
  const fields = []
  let field = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (insideQuotes) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        insideQuotes = false
      } else {
        field += character
      }
      continue
    }

    if (character === '"') insideQuotes = true
    else if (character === ',') {
      fields.push(field)
      field = ''
    } else field += character
  }

  fields.push(field)

  return fields
}

export function parseSuppressionCsv(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')

  if (lines.length === 0) return { errors: [], rows: [] }

  const header = splitCsvLine(lines[0]).map((column) => column.trim().toLowerCase())
  const valueIndex = header.indexOf('value') === -1 ? header.indexOf('email') : header.indexOf('value')

  if (valueIndex === -1) {
    return { errors: ['CSV needs a "value" or "email" column'], rows: [] }
  }

  const errors = []
  const rows = []

  for (const [lineOffset, line] of lines.slice(1).entries()) {
    const fields = splitCsvLine(line)
    const readColumn = (name) => {
      const columnIndex = header.indexOf(name)
      return columnIndex === -1 ? '' : (fields[columnIndex] || '').trim()
    }

    const value = normalizeEmail(fields[valueIndex])
    if (!value) {
      errors.push(`Row ${lineOffset + 2}: missing value`)
      continue
    }

    const matchType = readColumn('match_type') || (value.includes('@') ? 'email' : 'domain')
    const scope = readColumn('scope') || 'global'
    const campaign = readColumn('campaign') || null

    if (matchType === 'email' && !value.includes('@')) {
      errors.push(`Row ${lineOffset + 2}: "${value}" is not an email address`)
      continue
    }

    if (scope === 'campaign' && !campaign) {
      errors.push(`Row ${lineOffset + 2}: campaign scope needs a campaign key`)
      continue
    }

    rows.push({
      campaign: scope === 'campaign' ? campaign : null,
      created_at: readColumn('created_at') || undefined,
      match_type: matchType,
      reason: readColumn('reason') || 'Imported suppression',
      scope,
      source: readColumn('source') || SUPPRESSION_SOURCES.IMPORT,
      value
    })
  }

  return { errors, rows }
}
