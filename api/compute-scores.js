// ============================================================
// Automate305 SEP · /api/compute-scores.js
// Trigger health score computation for all active mailboxes.
// POST /api/compute-scores
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { computeAllScores } from '../lib/health-score.js'

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

  try {
    const scores = await computeAllScores()

    return res.status(200).json({
      message: `Computed health scores for ${scores.length} mailbox(es)`,
      scores,
    })
  } catch (err) {
    console.error('compute-scores error:', err)
    return res.status(500).json({ error: err.message })
  }
}
