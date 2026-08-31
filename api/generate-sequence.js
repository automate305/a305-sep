// ============================================================
// Automate305 SEP · /api/generate-sequence.js
// Generate a DRAFT email sequence via AI.
// POST /api/generate-sequence
// { "brand_slug", "campaign_slug", "icp_segment", "offer", "step_count" }
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { generateSequence } from '../lib/generation.js'

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

  const { brand_slug, campaign_slug, icp_segment, offer, step_count } = req.body

  if (!brand_slug || !campaign_slug || !icp_segment || !offer) {
    return res.status(400).json({
      error: 'brand_slug, campaign_slug, icp_segment, and offer are required'
    })
  }

  try {
    // Look up brand
    const { data: brand, error: brandErr } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', brand_slug)
      .single()

    if (brandErr || !brand) {
      return res.status(404).json({ error: `Brand "${brand_slug}" not found` })
    }

    // Look up campaign
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id')
      .eq('slug', campaign_slug)
      .eq('brand_id', brand.id)
      .single()

    if (campErr || !campaign) {
      return res.status(404).json({ error: `Campaign "${campaign_slug}" not found for brand "${brand_slug}"` })
    }

    const result = await generateSequence({
      brandId: brand.id,
      campaignId: campaign.id,
      icpSegment: icp_segment,
      offer,
      stepCount: step_count || 4,
    })

    if (result.error) {
      return res.status(422).json(result)
    }

    return res.status(200).json({
      message: 'Sequence generated as DRAFT',
      sequence: result.sequence,
      steps: result.steps,
      claimIssues: result.claimIssues,
    })
  } catch (err) {
    console.error('generate-sequence error:', err)
    return res.status(500).json({ error: err.message })
  }
}
