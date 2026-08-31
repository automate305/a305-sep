import { supabase } from './supabase.js'

const RAMP_SCHEDULE = [
  { minDay: 1,  maxDay: 3,  cap: 5 },
  { minDay: 4,  maxDay: 7,  cap: 10 },
  { minDay: 8,  maxDay: 14, cap: 15 },
  { minDay: 15, maxDay: 21, cap: 25 },
  { minDay: 22, maxDay: 28, cap: 35 },
]

const MIN_WARMUP_DAYS = 21
const TARGET_WARMUP_DAYS = 28
const GRADUATION_SCORE = 85

export function getWarmupDay(warmupStartedAt) {
  const start = new Date(warmupStartedAt)
  const now = new Date()
  return Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1
}

export function getDailyCap(warmupDay) {
  for (const tier of RAMP_SCHEDULE) {
    if (warmupDay >= tier.minDay && warmupDay <= tier.maxDay) return tier.cap
  }
  return RAMP_SCHEDULE[RAMP_SCHEDULE.length - 1].cap
}

export function canGraduate(warmupDay, healthScore) {
  return warmupDay >= MIN_WARMUP_DAYS && healthScore >= GRADUATION_SCORE
}

export function getGraduationBlockers(warmupDay, healthScore) {
  const blockers = []
  if (warmupDay < MIN_WARMUP_DAYS) {
    blockers.push(`${MIN_WARMUP_DAYS - warmupDay} days remaining in minimum warmup`)
  }
  if (healthScore === null || healthScore === undefined) {
    blockers.push('No health score computed yet')
  } else if (healthScore < GRADUATION_SCORE) {
    blockers.push(`Health score ${healthScore} is below graduation threshold of ${GRADUATION_SCORE}`)
  }
  return blockers
}

export async function updateWarmupCaps() {
  const { data: mailboxes } = await supabase
    .from('mailboxes')
    .select('id, warmup_started_at, status, daily_cap, health_score')
    .eq('status', 'WARMING')

  if (!mailboxes) return []

  const updates = []

  for (const mb of mailboxes) {
    const day = getWarmupDay(mb.warmup_started_at)
    const newCap = getDailyCap(day)

    if (newCap !== mb.daily_cap) {
      await supabase
        .from('mailboxes')
        .update({ daily_cap: newCap })
        .eq('id', mb.id)
      updates.push({ id: mb.id, day, oldCap: mb.daily_cap, newCap })
    }
  }

  return updates
}

export async function checkGraduations() {
  const { data: mailboxes } = await supabase
    .from('mailboxes')
    .select('id, address, warmup_started_at, health_score, status')
    .eq('status', 'WARMING')

  if (!mailboxes) return { graduated: [], blocked: [] }

  const graduated = []
  const blocked = []

  for (const mb of mailboxes) {
    const day = getWarmupDay(mb.warmup_started_at)

    if (canGraduate(day, mb.health_score)) {
      await supabase
        .from('mailboxes')
        .update({ status: 'WARM' })
        .eq('id', mb.id)
      graduated.push({ id: mb.id, address: mb.address, day, score: mb.health_score })
    } else if (day > TARGET_WARMUP_DAYS) {
      const blockers = getGraduationBlockers(day, mb.health_score)
      if (mb.health_score !== null && mb.health_score < GRADUATION_SCORE) {
        await supabase
          .from('mailboxes')
          .update({ status: 'BLOCKED' })
          .eq('id', mb.id)
      }
      blocked.push({ id: mb.id, address: mb.address, day, score: mb.health_score, blockers })
    }
  }

  return { graduated, blocked }
}

export { MIN_WARMUP_DAYS, TARGET_WARMUP_DAYS, GRADUATION_SCORE, RAMP_SCHEDULE }
