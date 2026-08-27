// ============================================================
// Automate305 SEP · enroll-contacts.js
// Enroll contacts into a sequence from a JSON file or inline.
//
// Usage:
//   node scripts/enroll-contacts.js --sequence dp4 --file contacts.json
//   node scripts/enroll-contacts.js --sequence clearview --file contacts.json
//
// contacts.json format:
// [
//   {
//     "email": "dr.jane@skinpractice.com",
//     "first_name": "Jane",
//     "practice_name": "Skin Practice Miami",
//     "city": "Miami",
//     "phone": "305-555-0100"
//   }
// ]
// ============================================================

import fs   from 'fs'
import path from 'path'

const WEBHOOK_URL    = process.env.WEBHOOK_URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET

async function main() {
  const args = process.argv.slice(2)
  const seqIdx  = args.indexOf('--sequence')
  const fileIdx = args.indexOf('--file')

  if (seqIdx === -1 || fileIdx === -1) {
    console.error('Usage: node enroll-contacts.js --sequence dp4 --file contacts.json')
    process.exit(1)
  }

  const sequence = args[seqIdx + 1]
  const filePath = args[fileIdx + 1]

  const contacts = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
  console.log(`\n📋 Enrolling ${contacts.length} contacts into "${sequence}" sequence...\n`)

  const res = await fetch(`${WEBHOOK_URL}/api/enroll`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-a305-secret': WEBHOOK_SECRET
    },
    body: JSON.stringify({ contacts, sequence })
  })

  const data = await res.json()
  console.log(data.message)

  if (data.results.enrolled.length > 0) {
    console.log('\n✅ Enrolled:')
    data.results.enrolled.forEach(e => console.log(`   ${e}`))
  }
  if (data.results.skipped.length > 0) {
    console.log('\n⏭  Already enrolled (skipped):')
    data.results.skipped.forEach(e => console.log(`   ${e}`))
  }
  if (data.results.errors.length > 0) {
    console.log('\n❌ Errors:')
    data.results.errors.forEach(e => console.log(`   ${e.email}: ${e.error}`))
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
