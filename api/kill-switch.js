// ============================================================
// Automate305 SEP · /api/kill-switch.js
// Toggle the global kill switch. When enabled, all sending stops.
// POST /api/kill-switch
// { "enabled": true }
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

  const { enabled } = req.body

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' })
  }

  try {
    const { error } = await supabase
      .from('global_settings')
      .upsert(
        { key: 'kill_switch', value: enabled, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )

    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({
      message: `Kill switch ${enabled ? 'ENABLED — all sending stopped' : 'DISABLED — sending resumed'}`,
      kill_switch: enabled,
    })
  } catch (err) {
    console.error('kill-switch error:', err)
    return res.status(500).json({ error: err.message })
  }
}
