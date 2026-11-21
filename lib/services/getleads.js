import { isUsableEnvironmentValue } from './smtp.js'
import { normalizeEmail } from './suppression.js'

export const GETLEADS_ENRICH_URL = 'https://app.getleads.io/api/v1/enrich/from-email'

const FILLABLE_FIELDS = [
  ['city', 'city'],
  ['company', 'company'],
  ['first_name', 'first_name'],
  ['last_name', 'last_name'],
  ['linkedin_url', 'linkedin_url'],
  ['phone', 'phone'],
  ['title', 'title']
]

export function getleadsConfigured(environment = process.env) {
  return isUsableEnvironmentValue(environment.GETLEADS_API_KEY)
}

function text(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim()
    if (normalized) return normalized
  }
  return ''
}

function resultRows(body) {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.results)) return body.results
  if (Array.isArray(body?.items)) return body.items
  if (Array.isArray(body?.data)) return body.data
  return []
}

export function readEnrichmentResults(body) {
  return resultRows(body).flatMap((row) => {
    if (!row || typeof row !== 'object' || row.success === false) return []

    const data = row.data && typeof row.data === 'object' ? row.data : row
    const email = normalizeEmail(row.email || row.input?.email || data.work_email || data.email)

    if (!email) return []

    return [{ data, email }]
  })
}

export function fieldsFromEnrichment(record) {
  const data = record?.data && typeof record.data === 'object' ? record.data : {}
  const role = text(data.current_role_status).toLowerCase()
  const currentRole = !role || role.includes('current')

  return {
    city: text(data.city, data.contact_city),
    company: currentRole ? text(data.company_name, data.current_company, data.company) : '',
    first_name: text(data.first_name),
    last_name: text(data.last_name),
    linkedin_url: text(data.linkedin_url, data.linkedinUrl, data.profileUrl, record?.linkedinUrl, record?.profileUrl),
    phone: text(data.mobile_phone, data.direct_dial, data.direct_phone, data.phone),
    title: currentRole ? text(data.current_title, data.title, data.job_title) : ''
  }
}

export function blankFill(contact, fields) {
  const patch = {}

  for (const [column, key] of FILLABLE_FIELDS) {
    if (!text(contact?.[column]) && fields?.[key]) patch[column] = fields[key]
  }

  return patch
}

export async function enrichContactsByEmail(emails, {
  environment = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!getleadsConfigured(environment)) {
    const configurationError = new Error('Add GETLEADS_API_KEY in Vercel, then enrich again. Nothing was changed.')
    configurationError.code = 'GETLEADS_NOT_CONFIGURED'
    throw configurationError
  }

  const items = [...new Set((emails || []).map((email) => normalizeEmail(email)).filter(Boolean))]
    .slice(0, 100)
    .map((email) => ({ email }))

  if (items.length === 0) return []

  let response
  try {
    response = await fetchImpl(GETLEADS_ENRICH_URL, {
      body: JSON.stringify({ items, limit_per_item: 1 }),
      headers: {
        Authorization: `Bearer ${environment.GETLEADS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      signal: AbortSignal.timeout(20000)
    })
  } catch {
    const networkError = new Error('GetLeads did not respond. Nothing was changed.')
    networkError.code = 'GETLEADS_UNREACHABLE'
    throw networkError
  }

  if (response.status === 401 || response.status === 403) {
    const authError = new Error('GetLeads refused the API key. Nothing was changed.')
    authError.code = 'GETLEADS_UNAUTHORIZED'
    throw authError
  }

  if (response.status === 429) {
    const rateError = new Error('GetLeads rate limit. Wait a minute and try again. Nothing was changed.')
    rateError.code = 'GETLEADS_RATE_LIMIT'
    throw rateError
  }

  if (!response.ok) {
    const statusError = new Error(`GetLeads returned ${response.status}. Nothing was changed.`)
    statusError.code = 'GETLEADS_HTTP_ERROR'
    throw statusError
  }

  return readEnrichmentResults(await response.json())
}
