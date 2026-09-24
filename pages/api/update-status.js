// ============================================================
// Automate305 SEP · /api/update-status.js
// Mark a contact as replied, bounced, or unsubscribed.
// Call this manually from Cowork when you see a reply/bounce
// in your Hostinger inbox.
//
// POST /api/update-status
// { "email": "contact@practice.com", "status": "replied" }
// status options: "replied" | "bounced" | "unsubscribed" | "paused" | "held"
// ============================================================

import { createClient } from '@supabase/supabase-js'

import { SUPPRESSION_SOURCES, suppressContact } from '../../lib/services/suppression.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  const secret = req.headers['x-a305-secret']
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, status, hold_reason } = req.body
  const validStatuses = ['replied', 'bounced', 'unsubscribed', 'paused', 'held', 'active']

  if (!email || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: `email and status required. Valid: ${validStatuses.join(', ')}`
    })
  }

  const normalizedEmail = email.toLowerCase().trim()

  // Unsubscribes and hard bounces are suppressions, so they go through the
  // one transaction that records the suppression, flags the contact and
  // stands the enrollments down together. Doing those as separate writes is
  // how a contact ends up suppressed in one table and mailable in another.
  if (status === 'unsubscribed' || status === 'bounced') {
    try {
      const result = await suppressContact(supabase, {
        email: normalizedEmail,
        reason: status === 'bounced'
          ? 'Hard bounce reported by an operator'
          : 'Unsubscribe reported by an operator',
        scope: 'global',
        source: status === 'bounced'
          ? SUPPRESSION_SOURCES.BOUNCE
          : SUPPRESSION_SOURCES.REPLY
      })

      if (!result?.contact_found) {
        return res.status(404).json({ error: 'Contact not found' })
      }

      // The contacts.bounced flag is separate from unsubscribed and the
      // function does not set it, so a bounce still records it here.
      if (status === 'bounced') {
        await supabase.from('contacts').update({ bounced: true }).eq('id', result.contact_id)
      }

      return res.status(200).json({
        contact_id: result.contact_id,
        enrollments_stood_down: result.enrollments_stood_down,
        message: `${normalizedEmail} marked as ${status} and suppressed`
      })
    } catch (suppressionError) {
      return res.status(503).json({ error: suppressionError.message })
    }
  }

  // Find contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', normalizedEmail)
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  // Update all active enrollments for this contact
  await supabase
    .from('enrollments')
    .update({
      status:       status,
      hold_reason:  status === 'held' ? hold_reason || 'Manual review required' : null,
      held_at:      status === 'held' ? new Date().toISOString() : null,
      completed_at: ['replied','bounced','unsubscribed'].includes(status)
        ? new Date().toISOString() : null
    })
    .eq('contact_id', contact.id)
    .eq('status', 'active')

  return res.status(200).json({
    message: `${email} marked as ${status}`,
    contact_id: contact.id
  })
}
