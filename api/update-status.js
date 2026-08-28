// ============================================================
// Automate305 SEP · /api/update-status.js
// Mark a contact as replied, bounced, or unsubscribed.
// Call this manually from Cowork when you see a reply/bounce
// in your Hostinger inbox.
//
// POST /api/update-status
// { "email": "contact@practice.com", "status": "replied" }
// status options: "replied" | "bounced" | "unsubscribed" | "paused"
// ============================================================

import { createClient } from '@supabase/supabase-js'

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

  const { email, status } = req.body
  const validStatuses = ['replied', 'bounced', 'unsubscribed', 'paused', 'active']

  if (!email || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: `email and status required. Valid: ${validStatuses.join(', ')}`
    })
  }

  // Find contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  // Update all active enrollments for this contact
  await supabase
    .from('enrollments')
    .update({
      status:       status,
      completed_at: ['replied','bounced','unsubscribed'].includes(status)
        ? new Date().toISOString() : null
    })
    .eq('contact_id', contact.id)
    .eq('status', 'active')

  // If bounced or unsubscribed, flag the contact record too
  if (status === 'bounced') {
    await supabase.from('contacts').update({ bounced: true }).eq('id', contact.id)
  }
  if (status === 'unsubscribed') {
    await supabase.from('contacts').update({ unsubscribed: true }).eq('id', contact.id)
  }

  return res.status(200).json({
    message: `${email} marked as ${status}`,
    contact_id: contact.id
  })
}
