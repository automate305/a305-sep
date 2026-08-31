// ============================================================
// Automate305 SEP · /api/ingest-replies.js
// Trigger IMAP ingestion for all active mailboxes.
// POST /api/ingest-replies
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { ingestMailbox } from '../lib/imap-ingestion.js'
import { getProvider } from '../lib/providers/index.js'

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

  try {
    // Fetch active mailboxes with their brand info
    const { data: mailboxes, error: mbErr } = await supabase
      .from('mailboxes')
      .select('id, address, brand_id, brands(id, slug, provider)')
      .eq('active', true)

    if (mbErr) return res.status(500).json({ error: mbErr.message })
    if (!mailboxes || mailboxes.length === 0) {
      return res.status(200).json({ message: 'No active mailboxes found', results: [] })
    }

    const results = []

    for (const mb of mailboxes) {
      try {
        const brand = mb.brands
        const provider = getProvider(brand.provider)

        const imapConfig = {
          user: mb.address,
          pass: provider.getSmtpAuth(mb.address).pass,
          host: provider.imapHost(brand.slug),
          port: provider.imapPort(brand.slug),
          tls: true,
        }

        const ingested = await ingestMailbox(mb.address, imapConfig, mb.brand_id, supabase)
        results.push({ mailbox: mb.address, ...ingested })
      } catch (err) {
        results.push({ mailbox: mb.address, error: err.message })
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        processed: acc.processed + (r.processed || 0),
        replies: acc.replies + (r.replies || 0),
        bounces: acc.bounces + (r.bounces || 0),
        unsubscribes: acc.unsubscribes + (r.unsubscribes || 0),
        errors: acc.errors + (r.errors || 0),
      }),
      { processed: 0, replies: 0, bounces: 0, unsubscribes: 0, errors: 0 }
    )

    return res.status(200).json({
      message: `Ingested ${totals.processed} message(s) across ${mailboxes.length} mailbox(es)`,
      totals,
      results,
    })
  } catch (err) {
    console.error('ingest-replies error:', err)
    return res.status(500).json({ error: err.message })
  }
}
