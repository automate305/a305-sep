// ============================================================
// Automate305 SEP · convert-contacts.js
// Turn a prospect CSV — or the cold-iq-gtm state.json queue — into
// enroll-ready JSON, split by HVAC sequence (hvac_a / hvac_b), in the
// exact shape scripts/enroll-contacts.js expects.
//
// Usage:
//   # From a CSV export (Apollo / getleads / Clay style headers):
//   node scripts/convert-contacts.js --csv prospects.csv [--out-dir .] \
//        [--sequence hvac_a|hvac_b]   # force all rows into one sequence
//
//   # From the cold-iq-gtm queue (carries personalized_line + A/B split):
//   node scripts/convert-contacts.js --queue path/to/state.json [--out-dir .]
//
// Output: writes <out-dir>/hvac_a.contacts.json and/or
//         hvac_b.contacts.json (only the non-empty ones). Those names match
//         the .gitignore *.contacts.json rule, so lead data stays out of git.
//
// CSV column mapping (case-insensitive, flexible):
//   First Name, Last Name, Title, Company, Domain, Email,
//   LinkedIn URL, City, State, Phone, Source
// Rows without an email are skipped. Duplicates (by email) are de-duped.
//
// A/B assignment:
//   --queue : uses each entry's own `sequence` field (A → hvac_a, B → hvac_b)
//   --csv   : --sequence forces one; otherwise alternates A/B by index so you
//             build test data (see email-sequence-b.md for the real split).
// ============================================================

import fs   from 'fs'
import path from 'path'

// ── tiny dependency-free CSV parser (handles quotes, commas, newlines) ──
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }   // escaped quote
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\r') {
      // ignore; handled by \n
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
}

// ── helpers ────────────────────────────────────────────────────────────
function stripLegalSuffix(name) {
  if (!name) return name
  return name
    .replace(/[\s,]+(inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|l\.p|lp)\.?$/i, '')
    .trim()
}

function normState(s) {
  if (!s) return 'FL'
  const t = s.trim()
  if (/^florida$/i.test(t)) return 'FL'
  return t
}

function cleanEmail(e) {
  return e ? e.toLowerCase().trim() : ''
}

// find a header's column index by any of several aliases
function colFinder(header) {
  const norm = header.map(h => h.trim().toLowerCase())
  return (...aliases) => {
    for (const a of aliases) {
      const idx = norm.indexOf(a.toLowerCase())
      if (idx !== -1) return idx
    }
    return -1
  }
}

// ── CSV → contacts ─────────────────────────────────────────────────────
function fromCsv(filePath, forcedSequence) {
  const rows = parseCsv(fs.readFileSync(path.resolve(filePath), 'utf8'))
  if (rows.length < 2) return []
  const header = rows[0]
  const col = colFinder(header)

  const iFirst = col('first name', 'first_name', 'firstname')
  const iLast  = col('last name', 'last_name', 'lastname')
  const iTitle = col('title', 'job title')
  const iComp  = col('company', 'company name', 'organization')
  const iEmail = col('email', 'work email')
  const iLink  = col('linkedin url', 'linkedin', 'linkedin_url')
  const iCity  = col('city')
  const iState = col('state')
  const iPhone = col('phone', 'phone number', 'mobile')
  const iSrc   = col('source')

  const out = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const email = cleanEmail(iEmail > -1 ? row[iEmail] : '')
    if (!email) continue
    const city = iCity > -1 ? (row[iCity] || '').trim() : ''
    out.push({
      email,
      first_name:   iFirst > -1 ? (row[iFirst] || '').trim() : '',
      last_name:    iLast  > -1 ? (row[iLast]  || '').trim() : '',
      company:      stripLegalSuffix(iComp > -1 ? (row[iComp] || '').trim() : ''),
      title:        iTitle > -1 ? (row[iTitle] || '').trim() : '',
      phone:        iPhone > -1 ? (row[iPhone] || '').trim() : '',
      city,
      state:        normState(iState > -1 ? row[iState] : ''),
      area:         city || 'South Florida',
      linkedin_url: iLink > -1 ? (row[iLink] || '').trim() : '',
      source:       (iSrc > -1 ? (row[iSrc] || '').trim() : '') || 'csv',
      _seq:         forcedSequence || null   // null → alternate later
    })
  }
  return out
}

// ── cold-iq-gtm state.json queue → contacts ────────────────────────────
function fromQueue(filePath) {
  const state = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
  const queue = state.queue || []
  const out = []
  for (const q of queue) {
    const email = cleanEmail(q.email)
    if (!email) continue
    if (q.status && q.status !== 'active') continue   // skip completed/replied
    const city = (q.city || '').trim()
    const isB  = String(q.sequence || 'A').toUpperCase() === 'B'
    const line = (q.personalized_line || '').trim() || undefined
    out.push({
      email,
      first_name:   (q.first_name || '').trim(),
      last_name:    (q.last_name  || '').trim(),
      company:      stripLegalSuffix((q.company || '').trim()),
      title:        (q.title || '').trim(),
      phone:        (q.phone || '') || '',
      city,
      state:        'FL',
      area:         city || 'South Florida',
      linkedin_url: (q.linkedin_url || '').trim(),
      source:       'coldiq',
      // Sequence B's opener uses {{personalized_paragraph}}; A's uses
      // {{personalized_line}}. cold-iq stores both as `personalized_line`,
      // so route the text into the field its template actually reads.
      personalized_line:      isB ? undefined : line,
      personalized_paragraph: isB ? line      : undefined,
      // 'A'/'B' → hvac_a/hvac_b; default to A if unlabeled
      _seq: isB ? 'hvac_b' : 'hvac_a'
    })
  }
  return out
}

// ── main ───────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}

function main() {
  const csv     = arg('--csv')
  const queue   = arg('--queue')
  const outDir  = arg('--out-dir') || '.'
  const forced  = arg('--sequence')   // hvac_a | hvac_b (CSV only)

  if (!csv && !queue) {
    console.error('Usage: node scripts/convert-contacts.js --csv <file> | --queue <state.json> [--out-dir .] [--sequence hvac_a|hvac_b]')
    process.exit(1)
  }
  if (forced && !['hvac_a', 'hvac_b'].includes(forced)) {
    console.error(`--sequence must be hvac_a or hvac_b (got "${forced}")`)
    process.exit(1)
  }

  let contacts = csv ? fromCsv(csv, forced) : fromQueue(queue)

  // De-dupe by email (first occurrence wins)
  const seen = new Set()
  contacts = contacts.filter(c => {
    if (seen.has(c.email)) return false
    seen.add(c.email); return true
  })

  // Assign any still-unrouted CSV rows by alternating A/B
  let altIdx = 0
  for (const c of contacts) {
    if (!c._seq) { c._seq = (altIdx % 2 === 0) ? 'hvac_a' : 'hvac_b'; altIdx++ }
  }

  // Split into buckets, drop the internal _seq marker
  const buckets = { hvac_a: [], hvac_b: [] }
  for (const c of contacts) {
    const seq = c._seq
    const { _seq, ...clean } = c
    // strip undefined keys for tidy JSON
    Object.keys(clean).forEach(k => clean[k] === undefined && delete clean[k])
    buckets[seq].push(clean)
  }

  fs.mkdirSync(path.resolve(outDir), { recursive: true })
  const written = []
  for (const seq of ['hvac_a', 'hvac_b']) {
    if (buckets[seq].length === 0) continue
    const file = path.join(outDir, `${seq}.contacts.json`)
    fs.writeFileSync(path.resolve(file), JSON.stringify(buckets[seq], null, 2))
    written.push({ seq, file, count: buckets[seq].length })
  }

  console.log(`\n📦 Converted ${contacts.length} contacts (${seen.size} unique emails)\n`)
  written.forEach(w => console.log(`   ${w.seq}: ${w.count} → ${w.file}`))
  if (written.length === 0) { console.log('   (no contacts with a valid email found)'); return }

  console.log('\nNext — enroll each file into its sequence:')
  written.forEach(w =>
    console.log(`   node scripts/enroll-contacts.js --sequence ${w.seq} --file ${w.file}`))
  console.log('')
}

main()
