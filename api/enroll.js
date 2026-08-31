import { createClient } from '@supabase/supabase-js'
import { isSuppressed } from '../lib/suppression.js'

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

  const { contacts, sequence, campaign, start_date } = req.body

  if (!contacts?.length || !sequence) {
    return res.status(400).json({ error: 'contacts[] and sequence are required' })
  }

  const { data: seq, error: seqErr } = await supabase
    .from('sequences')
    .select('id, brand_id, campaign_id')
    .eq('name', sequence)
    .eq('status', 'ACTIVE')
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (seqErr || !seq) {
    return res.status(404).json({ error: `Active sequence "${sequence}" not found` })
  }

  const results = { enrolled: [], skipped: [], suppressed: [], errors: [] }
  const sendDate = start_date || new Date().toISOString().split('T')[0]

  for (const contact of contacts) {
    try {
      const email = contact.email.toLowerCase().trim()

      const suppression = await isSuppressed(email, seq.brand_id)
      if (suppression.suppressed) {
        results.suppressed.push({ email, tier: suppression.tier, reason: suppression.reason })
        continue
      }

      const { data: c, error: cErr } = await supabase
        .from('contacts')
        .upsert({
          email,
          first_name:             contact.first_name,
          last_name:              contact.last_name,
          practice_name:          contact.practice_name,
          company:                contact.company,
          title:                  contact.title,
          phone:                  contact.phone,
          city:                   contact.city,
          state:                  contact.state || 'FL',
          linkedin_url:           contact.linkedin_url,
          source:                 contact.source || 'getleads',
          personalized_line:      contact.personalized_line,
          personalized_paragraph: contact.personalized_paragraph,
          pain_point:             contact.pain_point,
          area:                   contact.area,
          website_observation:    contact.website_observation,
        }, { onConflict: 'email' })
        .select()
        .single()

      if (cErr) throw cErr

      const { error: eErr } = await supabase
        .from('enrollments')
        .insert({
          contact_id:     c.id,
          sequence_id:    seq.id,
          brand_id:       seq.brand_id,
          campaign_id:    seq.campaign_id,
          current_step:   1,
          next_send_date: sendDate,
          status:         'active',
        })

      if (eErr?.code === '23505') {
        results.skipped.push(email)
      } else if (eErr) {
        throw eErr
      } else {
        results.enrolled.push(email)
      }
    } catch (err) {
      results.errors.push({ email: contact.email, error: err.message })
    }
  }

  return res.status(200).json({
    message: `${results.enrolled.length} enrolled, ${results.skipped.length} skipped, ${results.suppressed.length} suppressed, ${results.errors.length} errors`,
    results,
  })
}
