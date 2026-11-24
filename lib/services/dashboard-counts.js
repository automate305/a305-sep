export function emptyCampaignCounts() {
  return { aesthetic: 0, hvac: 0, total: 0 }
}

export function addCampaignCount(counts, campaign) {
  counts.total += 1
  if (campaign === 'aesthetic' || campaign === 'hvac') counts[campaign] += 1
}

export async function countAllRows(fetchPage) {
  const counts = emptyCampaignCounts()
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    for (const row of rows) addCampaignCount(counts, row.campaign)
    if (rows.length < pageSize) return counts
  }
}

export function applyUncappedCounts(metrics, { holdCount, holdCounts, queueCount, queueCounts }) {
  metrics.all.queued = queueCount ?? queueCounts.total
  metrics.aesthetic.queued = queueCounts.aesthetic
  metrics.hvac.queued = queueCounts.hvac
  metrics.all.held = holdCount ?? holdCounts.total
  metrics.aesthetic.held = holdCounts.aesthetic
  metrics.hvac.held = holdCounts.hvac
  return metrics
}
