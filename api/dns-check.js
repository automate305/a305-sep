// ============================================================
// Automate305 SEP · /api/dns-check.js
// Run DNS gate checks (SPF, DKIM, DMARC, MX, blacklist) per brand.
// POST /api/dns-check
// { "brand_slug": "cam" }          — single brand
// {} or no body                     — all brands
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { checkDns } from '../lib/dns-gate.js'
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
    const { brand_slug } = req.body || {}

    let query = supabase.from('brands').select('*')
    if (brand_slug) {
      query = query.eq('slug', brand_slug)
    }
    const { data: brands, error: brandErr } = await query

    if (brandErr) return res.status(500).json({ error: brandErr.message })
    if (!brands || brands.length === 0) {
      return res.status(404).json({ error: brand_slug ? `Brand "${brand_slug}" not found` : 'No brands found' })
    }

    const results = []

    for (const brand of brands) {
      try {
        const provider = getProvider(brand.provider)
        const dnsResult = await checkDns(brand, provider)

        // Store result in dns_check_results
        await supabase.from('dns_check_results').insert({
          brand_id: brand.id,
          domain: brand.domain,
          passed: dnsResult.passed,
          results: dnsResult.results,
          checked_at: new Date().toISOString(),
        })

        results.push({
          brand: brand.slug,
          domain: brand.domain,
          passed: dnsResult.passed,
          checks: dnsResult.results,
        })
      } catch (err) {
        results.push({
          brand: brand.slug,
          domain: brand.domain,
          passed: false,
          error: err.message,
        })
      }
    }

    return res.status(200).json({
      message: `DNS checks complete for ${results.length} brand(s)`,
      results,
    })
  } catch (err) {
    console.error('dns-check error:', err)
    return res.status(500).json({ error: err.message })
  }
}
