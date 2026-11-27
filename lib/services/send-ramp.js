import { easternDate } from './campaign-launch.js'

// First 5 sending days after a mailbox is warmed, then the next 5, then the
// steady cap. A sending day is a distinct America/New_York date with a
// prospect send, including today, not calendar time since warmed_at.
const DEFAULT_RAMP = {
  firstCap: 10,
  firstDays: 5,
  laterCap: 25,
  secondCap: 15,
  secondDays: 5
}

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function rampSchedule(environment = process.env) {
  return {
    firstCap: positiveInt(environment.OUTBOX_RAMP_FIRST_CAP, DEFAULT_RAMP.firstCap),
    firstDays: positiveInt(environment.OUTBOX_RAMP_FIRST_DAYS, DEFAULT_RAMP.firstDays),
    laterCap: positiveInt(environment.OUTBOX_RAMP_LATER_CAP, DEFAULT_RAMP.laterCap),
    secondCap: positiveInt(environment.OUTBOX_RAMP_SECOND_CAP, DEFAULT_RAMP.secondCap),
    secondDays: positiveInt(environment.OUTBOX_RAMP_SECOND_DAYS, DEFAULT_RAMP.secondDays)
  }
}

export function rampCapForSendingDay(sendingDay, environment = process.env) {
  const day = Math.max(Number(sendingDay) || 1, 1)
  const schedule = rampSchedule(environment)
  if (day <= schedule.firstDays) return schedule.firstCap
  if (day <= schedule.firstDays + schedule.secondDays) return schedule.secondCap
  return schedule.laterCap
}

export function effectiveDailyCap(sender) {
  const stored = Number(sender?.daily_limit || 0)
  const rampCap = sender?.ramp_cap == null ? stored : Number(sender.ramp_cap)
  if (!Number.isFinite(stored) || stored <= 0) return 0
  if (!Number.isFinite(rampCap) || rampCap <= 0) return 0
  return Math.min(stored, rampCap)
}

// prior distinct send dates, excluding today, plus today as the open day.
// No warmed_at and no history stays on day 1 so a mailbox cannot jump to the
// steady cap just because the column was added late.
export function sendingDayFromHistory({ now = new Date(), sentAtValues = [], warmedAt = null } = {}) {
  const today = easternDate(now)
  const anchor = warmedAt ? easternDate(new Date(warmedAt)) : null
  const prior = new Set()

  for (const value of sentAtValues) {
    if (!value) continue
    const key = easternDate(new Date(value))
    if (anchor && key < anchor) continue
    if (key < today) prior.add(key)
  }

  return prior.size + 1
}
