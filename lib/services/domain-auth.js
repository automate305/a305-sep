// ============================================================
// Automate305 SEP · lib/services/domain-auth.js
//
// Reports the real DNS authentication state of each sending domain:
// MX, SPF, DKIM, DMARC and domain blocklists.
//
// Three rules this module keeps:
//
//   1. Every status comes from a lookup made now, and says when. Each
//      result carries checkedAt, the hostnames queried and the record
//      text actually observed. Nothing is cached, nothing is assumed.
//
//   2. Three states, not two. "fail" means DNS answered and the answer
//      is wrong or absent. "unknown" means DNS did not answer (timeout,
//      server failure, a blocklist refusing us). Unknown is never
//      reported as pass.
//
//   3. Read-only. This module performs DNS reads and nothing else. It
//      imports no DNS-writing API and has no path that changes a record,
//      so rechecking can never alter DNS.
// ============================================================

import { Resolver } from 'node:dns/promises'

// Expected configuration per sending domain. Mirrors SMTP_PROVIDER_BY_DOMAIN
// in smtp.js: two domains, so a constant, not a table.
//
// dkimSelectors lists every selector the provider may publish; a domain
// passes when ANY of them holds a usable key.
export const DOMAIN_AUTH_BY_DOMAIN = {
  'aestheticdevicepro.com': {
    dkimSelectors: ['hostingermail-a', 'hostingermail-b', 'hostingermail-c'],
    mxPattern: /(^|\.)hostinger\.com\.?$/i,
    provider: 'hostinger',
    spfIncludes: ['_spf.mail.hostinger.com']
  },
  'automate305.com': {
    dkimSelectors: ['google'],
    mxPattern: /(^|\.)google\.com\.?$|(^|\.)googlemail\.com\.?$/i,
    provider: 'google-workspace',
    spfIncludes: ['_spf.google.com']
  }
}

// RFC 7208 §4.6.4: at most 10 DNS-querying terms per SPF evaluation.
export const SPF_LOOKUP_LIMIT = 10

const DNS_TIMEOUT_MS = 5000

// A definite "no such record". Everything else — timeouts, SERVFAIL,
// refused connections — means we could not find out.
const ABSENT_CODES = new Set(['ENOTFOUND', 'ENODATA'])

export function createDefaultResolver() {
  // One try, not two: a retry doubles the worst case for a record that is
  // not answering, and a stuck lookup is reported as unknown either way.
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 })

  return {
    resolve4: (hostname) => resolver.resolve4(hostname),
    resolveMx: (hostname) => resolver.resolveMx(hostname),
    resolveTxt: (hostname) => resolver.resolveTxt(hostname)
  }
}

function errorCode(error) {
  return typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : 'DNS_ERROR'
}

function isAbsent(error) {
  return ABSENT_CODES.has(errorCode(error))
}

// A TXT record may arrive split into several strings; they concatenate.
function joinTxtRecords(txtRecords) {
  return (txtRecords || []).map((chunks) => chunks.join(''))
}

function parseTags(record) {
  const tags = {}

  for (const part of String(record).split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    tags[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim()
  }

  return tags
}

function result(check, now, fields) {
  return {
    check,
    checkedAt: now().toISOString(),
    detail: '',
    observed: [],
    queried: [],
    status: 'unknown',
    warnings: [],
    ...fields
  }
}

// ── MX ───────────────────────────────────────────────────────
export async function evaluateMx(domain, expectation, { now, resolver }) {
  try {
    const records = await resolver.resolveMx(domain)
    const sorted = [...records].sort((left, right) => left.priority - right.priority)
    const observed = sorted.map((record) => `${record.priority} ${record.exchange}`)

    if (sorted.length === 0) {
      return result('mx', now, { detail: `No MX records at ${domain}`, queried: [domain], status: 'fail' })
    }

    const warnings = expectation?.mxPattern &&
      !sorted.some((record) => expectation.mxPattern.test(record.exchange))
      ? [`MX does not point at ${expectation.provider}; inbound replies may not reach the mailbox`]
      : []

    return result('mx', now, {
      detail: `${sorted.length} MX record${sorted.length === 1 ? '' : 's'}`,
      observed,
      queried: [domain],
      status: 'pass',
      warnings
    })
  } catch (error) {
    return result('mx', now, {
      detail: isAbsent(error)
        ? `No MX records at ${domain} (${errorCode(error)})`
        : `MX lookup did not complete (${errorCode(error)})`,
      queried: [domain],
      status: isAbsent(error) ? 'fail' : 'unknown'
    })
  }
}

// ── SPF ──────────────────────────────────────────────────────
// Walks the include/redirect chain rather than substring-matching the
// top-level record. automate305.com publishes
//   v=spf1 include:dc-aa8e722993._spfm.automate305.com ~all
// and the Google include lives one hop down. A substring check reports
// that as a failure; it is correctly configured.
const SPF_QUERYING_MECHANISMS = new Set(['include', 'a', 'mx', 'ptr', 'exists', 'redirect'])

function spfTerms(record) {
  return String(record).trim().split(/\s+/).slice(1)
}

function spfTermName(term) {
  const bare = term.replace(/^[+\-~?]/, '').toLowerCase()
  const separator = bare.search(/[:=/]/)

  return separator === -1 ? bare : bare.slice(0, separator)
}

function spfTermTarget(term) {
  const bare = term.replace(/^[+\-~?]/, '')
  const separator = bare.search(/[:=]/)

  return separator === -1 ? null : bare.slice(separator + 1).toLowerCase()
}

export async function evaluateSpf(domain, expectation, { now, resolver }) {
  const queried = []
  const observed = []
  const visited = new Set()
  const unresolved = []
  let lookupCount = 0
  let providerFound = false

  async function fetchSpf(hostname) {
    queried.push(hostname)
    const records = joinTxtRecords(await resolver.resolveTxt(hostname))

    return records.filter((record) => /^v=spf1(\s|$)/i.test(record))
  }

  async function walk(hostname, depth, prefetchedRecords = null) {
    if (depth > SPF_LOOKUP_LIMIT || visited.has(hostname)) return
    visited.add(hostname)

    let spfRecords = prefetchedRecords
    if (!spfRecords) {
      try {
        spfRecords = await fetchSpf(hostname)
      } catch (error) {
        unresolved.push(`${hostname} (${errorCode(error)})`)
        return
      }
    }

    if (spfRecords.length !== 1) {
      unresolved.push(`${hostname} (${spfRecords.length} SPF records)`)
      return
    }

    observed.push(`${hostname}: ${spfRecords[0]}`)

    for (const term of spfTerms(spfRecords[0])) {
      const name = spfTermName(term)
      if (!SPF_QUERYING_MECHANISMS.has(name)) continue

      lookupCount += 1
      const target = spfTermTarget(term)

      if ((name === 'include' || name === 'redirect') && target) {
        if (expectation?.spfIncludes?.includes(target)) providerFound = true
        await walk(target, depth + 1)
      }
    }
  }

  let rootRecords
  try {
    rootRecords = await fetchSpf(domain)
  } catch (error) {
    return result('spf', now, {
      detail: isAbsent(error)
        ? `No TXT records at ${domain} (${errorCode(error)})`
        : `SPF lookup did not complete (${errorCode(error)})`,
      lookupCount: 0,
      queried,
      status: isAbsent(error) ? 'fail' : 'unknown'
    })
  }

  if (rootRecords.length === 0) {
    return result('spf', now, { detail: `No SPF record at ${domain}`, lookupCount: 0, queried, status: 'fail' })
  }

  if (rootRecords.length > 1) {
    // RFC 7208 §4.5: more than one SPF record is a permanent error.
    return result('spf', now, {
      detail: `${rootRecords.length} SPF records at ${domain}; receivers treat that as a permanent error`,
      lookupCount: 0,
      observed: rootRecords,
      queried,
      status: 'fail'
    })
  }

  // The root was fetched above; hand it to the walk so it is not fetched twice.
  await walk(domain, 0, rootRecords)

  const allQualifier = spfTerms(rootRecords[0])
    .find((term) => spfTermName(term) === 'all')
  const warnings = []

  if (lookupCount > SPF_LOOKUP_LIMIT) {
    warnings.push(
      `SPF needs ${lookupCount} DNS lookups; the limit is ${SPF_LOOKUP_LIMIT}. ` +
      'Receivers return a permanent error and treat the message as unauthenticated.'
    )
  }

  // Terms inside an include we could not fetch were never counted, so the
  // count is a floor, not a measurement. Say so rather than print it as exact.
  if (unresolved.length > 0) {
    warnings.push(
      `Could not follow ${unresolved.join(', ')}; the lookup count is at least ` +
      `${lookupCount}, not exactly ${lookupCount}`
    )
  }

  if (allQualifier === '+all' || allQualifier === 'all') {
    warnings.push(`"${allQualifier}" authorises every server on the internet to send as ${domain}`)
  } else if (allQualifier === '?all') {
    warnings.push('"?all" is neutral; unauthorised senders are not rejected')
  }

  const providerName = expectation?.provider || 'the sending provider'
  const base = { lookupCount, observed, queried, warnings }

  if (lookupCount > SPF_LOOKUP_LIMIT) {
    return result('spf', now, { ...base, detail: `Over the SPF lookup limit (${lookupCount}/${SPF_LOOKUP_LIMIT})`, status: 'fail' })
  }

  if (providerFound) {
    return result('spf', now, {
      ...base,
      detail: `Authorises ${providerName} · ${lookupCount}/${SPF_LOOKUP_LIMIT} SPF lookups`,
      status: 'pass'
    })
  }

  if (unresolved.length > 0) {
    return result('spf', now, {
      ...base,
      detail: `Could not follow the whole chain: ${unresolved.join(', ')}`,
      status: 'unknown'
    })
  }

  return result('spf', now, {
    ...base,
    detail: expectation?.spfIncludes
      ? `Does not authorise ${providerName} (expected include:${expectation.spfIncludes.join(' or include:')})`
      : 'No provider expectation configured for this domain',
    status: expectation?.spfIncludes ? 'fail' : 'unknown'
  })
}

// ── DKIM ─────────────────────────────────────────────────────
// A record whose p= tag is empty is a REVOKED key (RFC 6376 §3.6.1). It
// exists, it parses, and it signs nothing. Testing for the presence of
// "p=" reports it as a pass; it has to be tested for a non-empty value.
export function inspectDkimRecord(record) {
  const tags = parseTags(record)

  if (!('p' in tags)) return { reason: 'record has no p= tag', usable: false }
  if (tags.p === '') return { reason: 'public key is empty (revoked)', usable: false }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(tags.p)) return { reason: 'public key is not base64', usable: false }

  return { keyType: tags.k || 'rsa', reason: null, usable: true }
}

export async function evaluateDkim(domain, expectation, { now, resolver, selectors }) {
  const selectorList = selectors || expectation?.dkimSelectors || []

  if (selectorList.length === 0) {
    return result('dkim', now, { detail: 'No DKIM selector configured for this domain', status: 'unknown' })
  }

  const perSelector = await Promise.all(selectorList.map(async (selector) => {
    const hostname = `${selector}._domainkey.${domain}`

    try {
      const records = joinTxtRecords(await resolver.resolveTxt(hostname))
      const candidate = records.find((record) => /(^|;)\s*v=DKIM1/i.test(record)) ||
        records.find((record) => /(^|;)\s*p=/i.test(record))

      if (!candidate) {
        return { hostname, outcome: 'found-unusable', reason: 'TXT present but not a DKIM record', record: records[0] || '', selector }
      }

      const inspection = inspectDkimRecord(candidate)

      return inspection.usable
        ? { hostname, keyType: inspection.keyType, outcome: 'valid', record: candidate, selector }
        : { hostname, outcome: 'found-unusable', reason: inspection.reason, record: candidate, selector }
    } catch (error) {
      return {
        code: errorCode(error),
        hostname,
        outcome: isAbsent(error) ? 'absent' : 'unknown',
        selector
      }
    }
  }))

  const queried = perSelector.map((entry) => entry.hostname)
  const observed = perSelector.map((entry) => {
    if (entry.outcome === 'valid') return `${entry.hostname}: usable ${entry.keyType} key`
    if (entry.outcome === 'found-unusable') return `${entry.hostname}: record found, ${entry.reason} — "${entry.record}"`
    if (entry.outcome === 'absent') return `${entry.hostname}: no record (${entry.code})`
    return `${entry.hostname}: lookup did not complete (${entry.code})`
  })

  const valid = perSelector.find((entry) => entry.outcome === 'valid')
  if (valid) {
    return result('dkim', now, {
      detail: `Usable key at selector "${valid.selector}"`,
      observed,
      queried,
      selectors: perSelector,
      status: 'pass'
    })
  }

  const unusable = perSelector.filter((entry) => entry.outcome === 'found-unusable')
  const unknown = perSelector.filter((entry) => entry.outcome === 'unknown')

  // Record found but useless is a definite failure, even if another
  // selector timed out: it is a published key that signs nothing.
  if (unusable.length > 0) {
    return result('dkim', now, {
      detail: `Record found at ${unusable.map((entry) => entry.hostname).join(', ')} ` +
        `but ${unusable[0].reason}` +
        (unknown.length > 0 ? `; ${unknown.map((entry) => entry.hostname).join(', ')} did not answer` : ''),
      observed,
      queried,
      selectors: perSelector,
      status: 'fail'
    })
  }

  if (unknown.length > 0) {
    return result('dkim', now, {
      detail: `No usable key found; ${unknown.map((entry) => entry.hostname).join(', ')} did not answer`,
      observed,
      queried,
      selectors: perSelector,
      status: 'unknown'
    })
  }

  return result('dkim', now, {
    detail: `No DKIM record at ${queried.join(', ')}`,
    observed,
    queried,
    selectors: perSelector,
    status: 'fail'
  })
}

// ── DMARC ────────────────────────────────────────────────────
export async function evaluateDmarc(domain, _expectation, { now, resolver }) {
  const hostname = `_dmarc.${domain}`

  try {
    const records = joinTxtRecords(await resolver.resolveTxt(hostname))
      .filter((record) => /^v=DMARC1(\s*;|$)/i.test(record))

    if (records.length === 0) {
      return result('dmarc', now, { detail: `No DMARC record at ${hostname}`, queried: [hostname], status: 'fail' })
    }

    if (records.length > 1) {
      return result('dmarc', now, {
        detail: `${records.length} DMARC records at ${hostname}; receivers ignore all of them`,
        observed: records,
        queried: [hostname],
        status: 'fail'
      })
    }

    const tags = parseTags(records[0])
    const policy = (tags.p || '').toLowerCase()

    if (!['none', 'quarantine', 'reject'].includes(policy)) {
      return result('dmarc', now, {
        detail: `DMARC record has no valid p= policy (found "${tags.p ?? ''}")`,
        observed: records,
        queried: [hostname],
        status: 'fail'
      })
    }

    const warnings = policy === 'none'
      ? ['Policy is p=none: monitoring only, receivers take no action on failures']
      : []

    return result('dmarc', now, {
      detail: `Policy p=${policy}${tags.rua ? ' · aggregate reports on' : ' · no aggregate reports (rua)'}`,
      observed: records,
      policy,
      queried: [hostname],
      status: 'pass',
      warnings
    })
  } catch (error) {
    return result('dmarc', now, {
      detail: isAbsent(error)
        ? `No DMARC record at ${hostname} (${errorCode(error)})`
        : `DMARC lookup did not complete (${errorCode(error)})`,
      queried: [hostname],
      status: isAbsent(error) ? 'fail' : 'unknown'
    })
  }
}

// ── DOMAIN BLOCKLISTS ────────────────────────────────────────
// Domain-based lists, not IP lists. Google Workspace and Hostinger send
// from shared IP pools, so the IP that matters is theirs, not ours; what
// is ours is the domain in the From line and in every signature.
//
// Each list is probed with its own always-listed test entry first. A
// list that does not report its test entry is refusing or filtering us
// (Spamhaus does this to public resolvers), and its "not listed" answers
// cannot be trusted — so that list reports unknown, never clean.
export const DOMAIN_BLOCKLISTS = [
  {
    decode(address) {
      // 127.255.255.x is an error reply (bad query, public resolver, rate limit).
      if (address.startsWith('127.255.255.')) return { error: true }
      const codes = {
        '127.0.1.2': 'spam domain',
        '127.0.1.4': 'phishing domain',
        '127.0.1.5': 'malware domain',
        '127.0.1.6': 'botnet C&C domain'
      }
      if (codes[address]) return { listed: true, reason: codes[address] }
      if (/^127\.0\.1\.1\d\d$/.test(address)) return { listed: true, reason: 'abused legitimate domain' }
      return { error: true }
    },
    name: 'Spamhaus DBL',
    testDomain: 'dbltest.com',
    zone: 'dbl.spamhaus.org'
  },
  {
    decode(address) {
      const match = /^127\.0\.0\.(\d+)$/.exec(address)
      if (!match) return { error: true }
      const bits = Number(match[1])
      // 127.0.0.1 is SURBL's "query refused" answer, not a listing.
      if (bits === 1) return { error: true }
      const lists = []
      if (bits & 8) lists.push('PH (phishing)')
      if (bits & 16) lists.push('MW (malware)')
      if (bits & 64) lists.push('ABUSE (spam/abuse)')
      if (bits & 128) lists.push('CR (cracked site)')
      return lists.length > 0 ? { listed: true, reason: lists.join(', ') } : { error: true }
    },
    name: 'SURBL multi',
    testDomain: 'test.surbl.org',
    zone: 'multi.surbl.org'
  }
]

async function queryBlocklist(list, domain, resolver) {
  const hostname = `${domain}.${list.zone}`

  try {
    const addresses = await resolver.resolve4(hostname)
    const decoded = addresses.map((address) => ({ address, ...list.decode(address) }))
    const listing = decoded.find((entry) => entry.listed)

    if (listing) return { address: listing.address, hostname, outcome: 'listed', reason: listing.reason }
    return { addresses, hostname, outcome: 'error' }
  } catch (error) {
    return isAbsent(error)
      ? { hostname, outcome: 'clean' }
      : { code: errorCode(error), hostname, outcome: 'error' }
  }
}

export async function evaluateBlocklist(domain, _expectation, { lists = DOMAIN_BLOCKLISTS, now, resolver }) {
  const perList = await Promise.all(lists.map(async (list) => {
    const probe = await queryBlocklist(list, list.testDomain, resolver)

    if (probe.outcome !== 'listed') {
      return {
        list: list.name,
        outcome: 'unavailable',
        reason: `test entry ${list.testDomain} was not reported as listed, so this list is not answering us honestly`
      }
    }

    const answer = await queryBlocklist(list, domain, resolver)

    if (answer.outcome === 'error') {
      return {
        list: list.name,
        outcome: 'unavailable',
        reason: `lookup did not complete (${answer.code || answer.addresses?.join(', ')})`
      }
    }

    return { list: list.name, ...answer }
  }))

  const queried = perList.filter((entry) => entry.hostname).map((entry) => entry.hostname)
  const observed = perList.map((entry) => {
    if (entry.outcome === 'listed') return `${entry.list}: LISTED — ${entry.reason} (${entry.address})`
    if (entry.outcome === 'clean') return `${entry.list}: not listed`
    return `${entry.list}: could not check — ${entry.reason}`
  })

  const listed = perList.filter((entry) => entry.outcome === 'listed')
  const unavailable = perList.filter((entry) => entry.outcome === 'unavailable')

  if (listed.length > 0) {
    return result('blocklist', now, {
      detail: `Listed on ${listed.map((entry) => `${entry.list} (${entry.reason})`).join('; ')}`,
      lists: perList,
      observed,
      queried,
      status: 'fail'
    })
  }

  if (unavailable.length > 0) {
    const checked = perList.filter((entry) => entry.outcome === 'clean').map((entry) => entry.list)
    return result('blocklist', now, {
      detail: (checked.length > 0 ? `Not listed on ${checked.join(', ')}; ` : '') +
        `could not check ${unavailable.map((entry) => entry.list).join(', ')}`,
      lists: perList,
      observed,
      queried,
      status: 'unknown'
    })
  }

  return result('blocklist', now, {
    detail: `Not listed on ${perList.map((entry) => entry.list).join(', ')}`,
    lists: perList,
    observed,
    queried,
    status: 'pass'
  })
}

// ── THE CHECK ────────────────────────────────────────────────
function overallStatus(results) {
  const statuses = Object.values(results).map((entry) => entry.status)

  if (statuses.includes('fail')) return 'fail'
  if (statuses.includes('unknown')) return 'unknown'
  return 'pass'
}

/**
 * @param {string} domain
 * @param {{ resolver?: any, now?: () => Date, expectation?: any }} [options]
 */
export async function checkDomainAuthentication(domain, {
  expectation,
  now = () => new Date(),
  resolver = createDefaultResolver()
} = {}) {
  const normalizedDomain = String(domain || '').trim().toLowerCase()
  const domainExpectation = expectation ?? DOMAIN_AUTH_BY_DOMAIN[normalizedDomain] ?? null
  const context = { now, resolver }
  const startedAt = now().toISOString()

  const [mx, spf, dkim, dmarc, blocklist] = await Promise.all([
    evaluateMx(normalizedDomain, domainExpectation, context),
    evaluateSpf(normalizedDomain, domainExpectation, context),
    evaluateDkim(normalizedDomain, domainExpectation, context),
    evaluateDmarc(normalizedDomain, domainExpectation, context),
    evaluateBlocklist(normalizedDomain, domainExpectation, context)
  ])

  const results = { blocklist, dkim, dmarc, mx, spf }

  return {
    checkedAt: startedAt,
    configured: domainExpectation !== null,
    domain: normalizedDomain,
    overall: overallStatus(results),
    provider: domainExpectation?.provider || null,
    results
  }
}

// The sender gate asks one question of this module: does this domain
// authenticate? Blocklist and MX are reported, not gated on — a listing
// is serious, but it is a reputation problem, not an authentication one.
export function domainAuthenticates(domainReport) {
  if (!domainReport) return false
  const { dkim, dmarc, spf } = domainReport.results

  return spf.status === 'pass' && dkim.status === 'pass' && dmarc.status === 'pass'
}

export function sendingDomainsFromSenders(senders) {
  const domains = new Set()

  for (const sender of senders || []) {
    const domain = String(sender.email || '').split('@')[1]?.trim().toLowerCase()
    if (domain) domains.add(domain)
  }

  return [...domains].sort()
}
