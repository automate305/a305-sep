// ============================================================
// Automate305 SEP · /api/enroll.js
// Add one or many contacts to a sequence.
// Called by your Cowork/getleads daily run.
//
// POST /api/enroll
// {
//   "contacts": [
//     {
//       "email": "dr.jane@skinpractice.com",
//       "first_name": "Jane",
//       "practice_name": "Skin Practice Miami",
//       "city": "Miami"
//     }
//   ],
//   "sequence": "dp4"          // or "clearview"
//   "start_date": "2026-06-09" // optional, defaults to today
// }
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

  const { contacts, sequence, start_date } = req.body

  if (!contacts?.length || !sequence) {
    return res.status(400).json({ error: 'contacts[] and sequence are required' })
  }

  // Get sequence ID
  const { data: seq, error: seqErr } = await supabase
    .from('sequences')
    .select('id')
    .eq('name', sequence)
    .single()

  if (seqErr || !seq) {
    return res.status(404).json({ error: `Sequence "${sequence}" not found` })
  }

  const results = { enrolled: [], skipped: [], errors: [] }
  const sendDate = start_date || new Date().toISOString().split('T')[0]

  for (const contact of contacts) {
    try {
      // Upsert contact
      const { data: c, error: cErr } = await supabase
        .from('contacts')
        .upsert({
          email:         contact.email.toLowerCase().trim(),
          first_name:    contact.first_name,
          last_name:     contact.last_name,
          practice_name: contact.practice_name,
          title:         contact.title,
          phone:         contact.phone,
          city:          contact.city,
          state:         contact.state || 'FL',
          source:        contact.source || 'getleads'
        }, { onConflict: 'email' })
        .select()
        .single()

      if (cErr) throw cErr

      // Enroll (skip if already enrolled in this sequence)
      const { error: eErr } = await supabase
        .from('enrollments')
        .insert({
          contact_id:     c.id,
          sequence_id:    seq.id,
          current_step:   1,
          next_send_date: sendDate,
          status:         'active'
        })

      if (eErr?.code === '23505') {
        // Unique violation — already enrolled
        results.skipped.push(contact.email)
      } else if (eErr) {
        throw eErr
      } else {
        results.enrolled.push(contact.email)
      }

    } catch (err) {
      results.errors.push({ email: contact.email, error: err.message })
    }
  }

  return res.status(200).json({
    message: `${results.enrolled.length} enrolled, ${results.skipped.length} skipped, ${results.errors.length} errors`,
    results
  })
}
