import { createClient } from '@supabase/supabase-js'

import { syncProspectReplies } from '../../../lib/services/reply-sync.js'
import { isUsableEnvironmentValue } from '../../../lib/services/smtp.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!isUsableEnvironmentValue(cronSecret) || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return res.status(503).json({ error: 'Reply check is not configured.' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  try {
    const result = await syncProspectReplies(supabase)

    return res.status(200).json(result)
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Reply check failed.' })
  }
}
