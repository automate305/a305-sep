// ============================================================
// Automate305 SEP · /api/hold-queue.js
// GET:  list all HELD items from send_queue with contact info
// POST: approve or skip a held item
//   { "queue_item_id": "uuid", "action": "approve" | "skip" }
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

  if (req.method === 'GET') {
    try {
      const { data: items, error } = await supabase
        .from('send_queue')
        .select('*, contacts(id, email, first_name, last_name, practice_name, company)')
        .eq('status', 'HELD')
        .order('scheduled_at', { ascending: true })

      if (error) return res.status(500).json({ error: error.message })

      return res.status(200).json({
        message: `${items.length} held item(s)`,
        items,
      })
    } catch (err) {
      console.error('hold-queue GET error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  if (req.method === 'POST') {
    const { queue_item_id, action } = req.body

    if (!queue_item_id || !['approve', 'skip'].includes(action)) {
      return res.status(400).json({
        error: 'queue_item_id and action ("approve" or "skip") are required'
      })
    }

    try {
      const newStatus = action === 'approve' ? 'PENDING' : 'SKIPPED'

      const { data, error } = await supabase
        .from('send_queue')
        .update({ status: newStatus, reviewed_at: new Date().toISOString() })
        .eq('id', queue_item_id)
        .eq('status', 'HELD')
        .select()
        .single()

      if (error) return res.status(500).json({ error: error.message })
      if (!data) return res.status(404).json({ error: 'Held item not found or already processed' })

      return res.status(200).json({
        message: `Queue item ${action === 'approve' ? 'approved (PENDING)' : 'skipped'}`,
        item: data,
      })
    } catch (err) {
      console.error('hold-queue POST error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
