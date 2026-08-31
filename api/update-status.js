// ============================================================
// Automate305 SEP · /api/update-status.js
// Mark a contact as replied, bounced, unsubscribed, paused, or active.
// Now brand-scoped: requires brand_slug so suppressions and
// enrollment pauses target the correct brand.
//
// POST /api/update-status
// { "email": "contact@practice.com", "status": "replied", "brand_slug": "cam" }
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { pauseContactSequences, addBrandSuppression } from '../lib/suppression.js'

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

  const { email, status, brand_slug } = req.body
  const validStatuses = ['replied', 'bounced', 'unsubscribed', 'paused', 'active']

  if (!email || !validStatuses.includes(status) || !brand_slug) {
    return res.status(400).json({
      error: `email, status, and brand_slug required. Valid statuses: ${validStatuses.join(', ')}`
    })
  }

  // Find contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .single()

  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  // Find brand
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', brand_slug)
    .single()

  if (!brand) return res.status(404).json({ error: `Brand "${brand_slug}" not found` })

  try {
    switch (status) {
      case 'replied':
        // Tier 3 campaign pause: pause all active enrollments for this contact within the brand
        await pauseContactSequences(contact.id, brand.id)
        await supabase
          .from('enrollments')
          .update({ status: 'replied', completed_at: new Date().toISOString() })
          .eq('contact_id', contact.id)
          .eq('brand_id', brand.id)
          .eq('status', 'paused')
        break

      case 'bounced':
        await addBrandSuppression(brand.id, email.toLowerCase().trim(), 'hard_bounce', 'manual')
        await supabase
          .from('enrollments')
          .update({ status: 'bounced', completed_at: new Date().toISOString() })
          .eq('contact_id', contact.id)
          .eq('brand_id', brand.id)
          .eq('status', 'active')
        await supabase.from('contacts').update({ bounced: true }).eq('id', contact.id)
        break

      case 'unsubscribed':
        await addBrandSuppression(brand.id, email.toLowerCase().trim(), 'unsubscribe', 'manual')
        await supabase
          .from('enrollments')
          .update({ status: 'unsubscribed', completed_at: new Date().toISOString() })
          .eq('contact_id', contact.id)
          .eq('brand_id', brand.id)
          .eq('status', 'active')
        await supabase.from('contacts').update({ unsubscribed: true }).eq('id', contact.id)
        break

      case 'paused':
      case 'active':
        await supabase
          .from('enrollments')
          .update({
            status,
            completed_at: null,
          })
          .eq('contact_id', contact.id)
          .eq('brand_id', brand.id)
          .in('status', status === 'paused' ? ['active'] : ['paused'])
        break
    }

    return res.status(200).json({
      message: `${email} marked as ${status} for brand ${brand_slug}`,
      contact_id: contact.id,
      brand_id: brand.id,
    })
  } catch (err) {
    console.error('update-status error:', err)
    return res.status(500).json({ error: err.message })
  }
}
