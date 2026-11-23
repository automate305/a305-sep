// Operator read for the Outbox MCP. No credentials, no message bodies.
import { createClient } from '@supabase/supabase-js'

import { isUsableEnvironmentValue } from '../../lib/services/smtp.js'

const HELD_LIMIT = 25

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  const configured = process.env.WEBHOOK_SECRET
  if (!isUsableEnvironmentValue(configured) || req.headers['x-a305-secret'] !== configured) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY
  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return res.status(503).json({ error: 'Supabase is not configured' })
  }

  const campaign = typeof req.query.campaign === 'string' ? req.query.campaign.trim() : ''
  if (campaign && !/^[a-z0-9_]+$/.test(campaign)) {
    return res.status(400).json({ error: 'Invalid campaign filter' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  let sequenceQuery = supabase
    .from('sequences')
    .select('name,campaign,description,active')
    .order('name')
  let senderQuery = supabase
    .from('senders')
    .select('email,name,campaign,daily_limit,sends_today,warmed,active,host')
    .order('campaign')
    .order('email')
  let pipelineQuery = supabase.from('pipeline_summary').select('sequence,campaign,active,completed,replied,unsubscribed,bounced,total')
  let heldQuery = supabase
    .from('enrollments')
    .select('id,held_at,hold_reason,current_step,sequences(name,campaign),contacts(email,first_name,company)')
    .eq('status', 'held')
    .order('held_at', { ascending: true })
    .limit(HELD_LIMIT)

  if (campaign) {
    sequenceQuery = sequenceQuery.eq('campaign', campaign)
    senderQuery = senderQuery.eq('campaign', campaign)
    pipelineQuery = pipelineQuery.eq('campaign', campaign)
  }

  const [sequences, senders, pipeline, held] = await Promise.all([
    sequenceQuery,
    senderQuery,
    pipelineQuery,
    heldQuery
  ])
  const failed = [sequences, senders, pipeline, held].find((result) => result.error)
  if (failed) {
    return res.status(503).json({ error: 'Unable to load Outbox overview' })
  }

  let heldRows = held.data || []
  if (campaign) {
    heldRows = heldRows.filter((row) => row.sequences?.campaign === campaign)
  }

  return res.status(200).json({
    campaign: campaign || null,
    held: heldRows.map((row) => ({
      campaign: row.sequences?.campaign || null,
      company: row.contacts?.company || null,
      current_step: row.current_step,
      email: row.contacts?.email || null,
      enrollment_id: row.id,
      first_name: row.contacts?.first_name || null,
      held_at: row.held_at,
      hold_reason: row.hold_reason,
      sequence: row.sequences?.name || null
    })),
    held_limit: HELD_LIMIT,
    pipeline: pipeline.data || [],
    senders: senders.data || [],
    sequences: sequences.data || []
  })
}
