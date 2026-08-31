import { buildQueue, processQueue, isKillSwitchOn } from '../lib/send-loop.js'
import { updateWarmupCaps, checkGraduations } from '../lib/warmup.js'

export default async function handler(req, res) {
  const secret = req.headers['x-a305-secret']
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (await isKillSwitchOn()) {
      return res.status(200).json({ message: 'Kill switch is ON. No sends processed.', results: { sent: [], failed: [], skipped: [] } })
    }

    const warmupUpdates = await updateWarmupCaps()
    const graduations = await checkGraduations()

    const queued = await buildQueue()
    const results = await processQueue()

    return res.status(200).json({
      message: `Done. ${results.sent.length} sent, ${results.failed.length} failed, ${results.skipped.length} skipped.`,
      results,
      warmup: { capUpdates: warmupUpdates, graduations },
      queued: queued.length,
    })
  } catch (err) {
    console.error('Send handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
