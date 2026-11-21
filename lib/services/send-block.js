import { normalizeEmail } from './suppression.js'

function rowMatches(row, email, campaign) {
  const scopeMatches = row.scope === 'global' ||
    (row.scope === 'campaign' && row.campaign === campaign)

  if (!scopeMatches) return false
  if (row.match_type === 'email') return row.value === email

  const domain = email.split('@')[1] || ''

  return row.match_type === 'domain' && row.value === domain
}

export function blockingSuppression(rows, email, campaign) {
  const normalized = normalizeEmail(email)
  const match = (rows || []).find((row) => rowMatches(row, normalized, campaign))

  if (!match) return null

  const status = match.source === 'reply'
    ? 'replied'
    : match.source === 'bounce'
      ? 'bounced'
      : 'unsubscribed'

  return { reason: 'Suppressed address', status }
}

export function suppressionBlocks(rows, email, campaign) {
  return Boolean(blockingSuppression(rows, email, campaign))
}

export async function loadSuppressionRows(supabase, emails) {
  const normalized = [...new Set((emails || []).map((email) => normalizeEmail(email)).filter(Boolean))]
  const domains = [...new Set(normalized.map((email) => email.split('@')[1]).filter(Boolean))]
  const values = [...normalized, ...domains]

  if (values.length === 0) return []

  const { data, error } = await supabase
    .from('suppressions')
    .select('value,match_type,scope,campaign,source')
    .in('value', values)

  if (error) {
    const lookupError = new Error('Suppression lookup failed. No email was sent.')
    lookupError.code = 'SUPPRESSION_LOOKUP_FAILED'
    throw lookupError
  }

  return data || []
}
