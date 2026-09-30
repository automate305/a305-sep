// ============================================================
// Automate305 SEP · /api/cron/daily-warmup
//
// Fires runHostingerWarmup() on a schedule instead of requiring someone
// to click "Send today's seed mail" in the dashboard every day. Same
// auth pattern as /api/cron/daily-send: a bearer CRON_SECRET, and an
// explicit automation flag that defaults off.
//
// Every day, not just weekdays — inbox warmup benefits from consistency,
// and a gap here is exactly what made the ramp jump straight to its
// highest cap the last time this went quiet (see activeWarmupDay in
// lib/services/warmup.ts).
//
// This route never sets `warmed`, never touches `warmup_started_at`, and
// never sends to a real prospect — runHostingerWarmup only ever mails
// WARMUP_SEED_RECIPIENTS.
// ============================================================

import { isUsableEnvironmentValue } from '../../../lib/services/smtp.js'
import { runHostingerWarmup } from '../../../lib/services/warmup.ts'

const automationEnabled = () => process.env.WARMUP_AUTOMATION_ENABLED === 'true'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!isUsableEnvironmentValue(cronSecret) || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!automationEnabled()) {
    return res.status(200).json({
      automation: 'disabled',
      message: 'Automated warmup sending is intentionally disabled until turned on.'
    })
  }

  const result = await runHostingerWarmup()

  return res.status(result.ok ? 200 : 503).json(result)
}
