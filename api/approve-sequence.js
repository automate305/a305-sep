// ============================================================
// Automate305 SEP · /api/approve-sequence.js
// Move a sequence through the DRAFT -> APPROVED -> ACTIVE lifecycle.
// POST /api/approve-sequence
// { "sequence_id": "uuid", "action": "approve" | "activate" }
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

  const { sequence_id, action } = req.body

  if (!sequence_id || !['approve', 'activate'].includes(action)) {
    return res.status(400).json({
      error: 'sequence_id and action ("approve" or "activate") are required'
    })
  }

  try {
    // Fetch the sequence
    const { data: seq, error: seqErr } = await supabase
      .from('sequences')
      .select('id, status, campaign_id, name')
      .eq('id', sequence_id)
      .single()

    if (seqErr || !seq) {
      return res.status(404).json({ error: 'Sequence not found' })
    }

    if (action === 'approve') {
      if (seq.status !== 'DRAFT') {
        return res.status(400).json({
          error: `Cannot approve: sequence is "${seq.status}", must be "DRAFT"`
        })
      }

      const { error } = await supabase
        .from('sequences')
        .update({ status: 'APPROVED', approved_at: new Date().toISOString() })
        .eq('id', sequence_id)

      if (error) return res.status(500).json({ error: error.message })

      return res.status(200).json({
        message: `Sequence "${seq.name}" approved`,
        sequence_id,
        status: 'APPROVED',
      })
    }

    if (action === 'activate') {
      if (seq.status !== 'APPROVED') {
        return res.status(400).json({
          error: `Cannot activate: sequence is "${seq.status}", must be "APPROVED". There is no path from DRAFT to ACTIVE without approval.`
        })
      }

      // Archive any other ACTIVE sequence for this campaign.
      // Contacts mid-sequence on the archived version stay on that version.
      await supabase
        .from('sequences')
        .update({ status: 'ARCHIVED', archived_at: new Date().toISOString() })
        .eq('campaign_id', seq.campaign_id)
        .eq('status', 'ACTIVE')
        .neq('id', sequence_id)

      const { error } = await supabase
        .from('sequences')
        .update({ status: 'ACTIVE', activated_at: new Date().toISOString() })
        .eq('id', sequence_id)

      if (error) return res.status(500).json({ error: error.message })

      return res.status(200).json({
        message: `Sequence "${seq.name}" activated. Previous ACTIVE sequence(s) for this campaign archived.`,
        sequence_id,
        status: 'ACTIVE',
      })
    }
  } catch (err) {
    console.error('approve-sequence error:', err)
    return res.status(500).json({ error: err.message })
  }
}
