// Move one held enrollment to active or paused. Same decision as the dashboard.
import { createClient } from '@supabase/supabase-js'

import { isUsableEnvironmentValue } from '../../lib/services/smtp.js'

const ENROLLMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function easternDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const configured = process.env.WEBHOOK_SECRET
  if (!isUsableEnvironmentValue(configured) || req.headers['x-a305-secret'] !== configured) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const enrollmentId = String(req.body?.enrollment_id || '')
  const decision = req.body?.decision
  if (!ENROLLMENT_ID.test(enrollmentId) || !['approve', 'skip'].includes(decision)) {
    return res.status(400).json({ error: 'enrollment_id and decision (approve or skip) are required' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return res.status(503).json({ error: 'Supabase is not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const nextStatus = decision === 'approve' ? 'active' : 'paused'
  const { data, error } = await supabase
    .from('enrollments')
    .update({
      next_send_date: easternDate(),
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'mcp',
      status: nextStatus
    })
    .eq('id', enrollmentId)
    .eq('status', 'held')
    .select('id')
    .maybeSingle()

  if (error) return res.status(503).json({ error: 'Review failed' })
  if (!data) return res.status(409).json({ error: 'This hold was already reviewed' })

  return res.status(200).json({
    enrollment_id: data.id,
    message: decision === 'approve' ? 'Approved for the next send run.' : 'Skipped and paused.',
    status: nextStatus
  })
}
