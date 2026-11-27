import { easternDate } from './campaign-launch.js'

export function outboxRunRecord({
  campaign = null,
  counts = {},
  details = {},
  job,
  status,
  stopReason = null
}) {
  return {
    campaign,
    counts,
    details,
    job,
    run_at: new Date().toISOString(),
    status,
    stop_reason: stopReason
  }
}

// Logging is best-effort. A missing table must not hide the run result or
// turn a completed decision into a second failure.
export async function recordOutboxRun(supabase, record) {
  console.log(JSON.stringify(record))
  if (!supabase) return { persisted: false }

  try {
    const { error } = await supabase.from('outbox_run_log').insert({
      campaign: record.campaign,
      counts: record.counts,
      details: record.details,
      job: record.job,
      run_at: record.run_at,
      status: record.status,
      stop_reason: record.stop_reason
    })
    if (error) {
      console.error(JSON.stringify({
        job: record.job,
        outboxRunPersistError: error.message
      }))
      return { error: error.message, persisted: false }
    }
    return { persisted: true }
  } catch (error) {
    console.error(JSON.stringify({
      job: record.job,
      outboxRunPersistError: error.message || 'outbox run log insert failed'
    }))
    return { error: error.message, persisted: false }
  }
}

// Date-keyed reset. Rows already counted for today's America/New_York date
// stay put, so a second daily-send or a manual send cannot double the cap.
export async function resetSendsForEasternDay(supabase, {
  allowLegacyRpc = false,
  now = new Date()
} = {}) {
  const today = easternDate(now)
  const { error } = await supabase
    .from('senders')
    .update({ sends_today: 0, sends_today_on: today })
    .or(`sends_today_on.is.null,sends_today_on.lt.${today}`)

  if (!error) return { mode: 'dated', ok: true, today }

  const missingColumn = /sends_today_on/.test(error.message || '')
  if (missingColumn && allowLegacyRpc) {
    const legacy = await supabase.rpc('reset_daily_sends')
    if (!legacy.error) {
      return {
        mode: 'legacy',
        ok: true,
        today,
        warning: 'sends_today_on is not available; daily counters were reset without a date key'
      }
    }
    return { error: legacy.error.message, missingColumn: true, ok: false, today }
  }

  return { error: error.message, missingColumn, ok: false, today }
}
