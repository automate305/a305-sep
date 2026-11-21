import { SUPPRESSION_SOURCES, normalizeEmail, suppressContact } from './suppression.js'

const IN_FLIGHT = ['active', 'held', 'paused']

async function inflightEnrollmentIds(supabase, contactId) {
  const { data, error } = await supabase
    .from('enrollments')
    .select('id')
    .eq('contact_id', contactId)
    .in('status', IN_FLIGHT)

  if (error) throw new Error(`Enrollment lookup failed: ${error.message}`)

  return (data || []).map((row) => row.id)
}

// Captures in-flight steps first, then records the suppression, then
// relabels those exact steps. The database function currently in
// production stands down active rows only and labels them unsubscribed.
// Writing the captured ids back is what also stops a held approval and
// keeps a reply counted as a reply.
async function stopInFlight(supabase, email, { contactPatch = null, enrollmentStatus, reason, source }) {
  const normalized = normalizeEmail(email)
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()

  if (contactError) throw new Error(`Contact lookup failed: ${contactError.message}`)

  const ids = contact ? await inflightEnrollmentIds(supabase, contact.id) : []
  const result = await suppressContact(supabase, {
    email: normalized,
    reason,
    scope: 'global',
    source
  })

  if (ids.length > 0) {
    const { error } = await supabase
      .from('enrollments')
      .update({
        completed_at: new Date().toISOString(),
        held_at: null,
        hold_reason: null,
        status: enrollmentStatus
      })
      .in('id', ids)

    if (error) throw new Error(`Enrollment stand-down failed: ${error.message}`)
  }

  if (contact && contactPatch) {
    const { error } = await supabase
      .from('contacts')
      .update(contactPatch)
      .eq('id', contact.id)

    if (error) throw new Error(`Contact update failed: ${error.message}`)
  }

  return {
    contact_found: Boolean(result?.contact_found),
    contact_id: result?.contact_id || contact?.id || null,
    enrollments_stood_down: ids.length
  }
}

export function stopContactForReply(supabase, email, reason = 'Reply received. Sequence stopped.') {
  return stopInFlight(supabase, email, {
    enrollmentStatus: 'replied',
    reason,
    source: SUPPRESSION_SOURCES.REPLY
  })
}

export function stopContactForBounce(supabase, email, reason = 'Hard bounce') {
  return stopInFlight(supabase, email, {
    contactPatch: { bounced: true },
    enrollmentStatus: 'bounced',
    reason,
    source: SUPPRESSION_SOURCES.BOUNCE
  })
}
