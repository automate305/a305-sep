// ============================================================
// Automate305 SEP · daily-trigger.js
// Run this from Cowork every morning:
//   node scripts/daily-trigger.js
//
// What it does:
//   1. Resets sender daily counts in Supabase
//   2. Calls /api/send to process today's queue
//   3. Prints a summary to your terminal
// ============================================================

const WEBHOOK_URL    = process.env.WEBHOOK_URL    // your Vercel URL, e.g. https://a305-sep.vercel.app
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET // shared secret

async function resetDailySends() {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )
  await supabase.rpc('reset_daily_sends')
  console.log('🔄 Daily send counts reset')
}

async function triggerSend() {
  console.log(`\n📬 Automate305 SEP — Daily Run · ${new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
  })}\n`)

  await resetDailySends()

  // Ingest replies before sending (pauses sequences on reply, suppresses bounces)
  console.log('📥 Ingesting replies...')
  const ingestRes = await fetch(`${WEBHOOK_URL}/api/ingest-replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-a305-secret': WEBHOOK_SECRET },
    body: JSON.stringify({})
  })
  if (ingestRes.ok) {
    const ingestData = await ingestRes.json()
    console.log(`   ${ingestData.total_ingested || 0} messages ingested\n`)
  } else {
    console.log('   ⚠️  Reply ingestion failed, continuing with send\n')
  }

  // Compute health scores
  console.log('📊 Computing health scores...')
  const scoreRes = await fetch(`${WEBHOOK_URL}/api/compute-scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-a305-secret': WEBHOOK_SECRET },
    body: JSON.stringify({})
  })
  if (scoreRes.ok) {
    const scoreData = await scoreRes.json()
    console.log(`   ${scoreData.scores?.length || 0} scores computed\n`)
  } else {
    console.log('   ⚠️  Score computation failed, continuing with send\n')
  }

  console.log('📤 Triggering send webhook...\n')

  const res = await fetch(`${WEBHOOK_URL}/api/send`, {
    method:  'POST',
    headers: {
      'Content-Type':   'application/json',
      'x-a305-secret':  WEBHOOK_SECRET
    },
    body: JSON.stringify({})
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('❌ Webhook error:', data)
    process.exit(1)
  }

  // Pretty summary
  console.log('─'.repeat(50))
  console.log(`✅ Sent:    ${data.results.sent.length}`)
  console.log(`❌ Failed:  ${data.results.failed.length}`)
  console.log(`⏭  Skipped: ${data.results.skipped?.length || 0}`)
  console.log('─'.repeat(50))

  if (data.results.sent.length > 0) {
    console.log('\n📨 Sent today:')
    data.results.sent.forEach(s => {
      console.log(`   Step ${s.step} → ${s.email} (via ${s.sender})`)
    })
  }

  if (data.results.failed.length > 0) {
    console.log('\n⚠️  Failed:')
    data.results.failed.forEach(f => {
      console.log(`   ${f.email}: ${f.error}`)
    })
  }

  console.log('\n✨ Done. Check Hostinger inbox for replies.\n')
}

triggerSend().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
