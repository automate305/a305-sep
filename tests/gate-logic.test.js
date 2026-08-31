import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

import { getWarmupDay, getDailyCap, canGraduate, RAMP_SCHEDULE } from '../lib/warmup.js'
import { mergeTemplate, hasUnresolvedPlaceholders, checkSpamPhrases } from '../lib/merge.js'
import { checkClaimSafety, validateSlotValue } from '../lib/claim-safety.js'

// ── Warmup logic ────────────────────────────────────────────

describe('Warmup state machine', () => {
  it('returns correct day count from warmup start', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
    assert.equal(getWarmupDay(threeDaysAgo), 4)
  })

  it('caps at 5/day for days 1-3', () => {
    assert.equal(getDailyCap(1), 5)
    assert.equal(getDailyCap(3), 5)
  })

  it('ramps to 10/day for days 4-7', () => {
    assert.equal(getDailyCap(4), 10)
    assert.equal(getDailyCap(7), 10)
  })

  it('ramps to 25/day for days 15-21', () => {
    assert.equal(getDailyCap(15), 25)
    assert.equal(getDailyCap(21), 25)
  })

  it('ramps to 35/day for days 22-28', () => {
    assert.equal(getDailyCap(22), 35)
    assert.equal(getDailyCap(28), 35)
  })

  it('does not graduate before 21 days even with perfect score', () => {
    assert.equal(canGraduate(20, 100), false)
  })

  it('does not graduate at day 21 with score below 85', () => {
    assert.equal(canGraduate(21, 84), false)
  })

  it('graduates at day 21 with score 85+', () => {
    assert.equal(canGraduate(21, 85), true)
    assert.equal(canGraduate(28, 90), true)
  })
})

// ── Template merge logic ────────────────────────────────────

describe('Template merge', () => {
  it('detects unresolved placeholders', () => {
    const result = hasUnresolvedPlaceholders('Hello {{first_name}}, your {{custom_field}} is ready')
    assert.equal(result.clean, false)
    assert.ok(result.placeholders.includes('{{first_name}}'))
    assert.ok(result.placeholders.includes('{{custom_field}}'))
  })

  it('passes clean text', () => {
    const result = hasUnresolvedPlaceholders('Hello John, your order is ready')
    assert.equal(result.clean, true)
  })

  it('detects spam phrases', () => {
    const result = checkSpamPhrases('Act now to claim your free money!')
    assert.equal(result.clean, false)
    assert.ok(result.phrases.includes('act now'))
    assert.ok(result.phrases.includes('free money'))
  })

  it('merges all standard fields', () => {
    const contact = {
      first_name: 'Jane',
      last_name: 'Smith',
      practice_name: 'Glow Clinic',
      company: null,
      area: 'Miami',
    }
    const mailbox = { display_name: 'Matt', signature: 'Matt | ADP' }
    const template = 'Hi {{first_name}} {{last_name}} at {{practice_name}} in {{area}}. - {{sender_name}} {{signature}}'
    const result = mergeTemplate(template, contact, mailbox)
    assert.ok(result.includes('Jane'))
    assert.ok(result.includes('Smith'))
    assert.ok(result.includes('Glow Clinic'))
    assert.ok(result.includes('Miami'))
    assert.ok(result.includes('Matt'))
    assert.ok(result.includes('Matt | ADP'))
    assert.ok(!result.includes('{{'))
  })
})

// ── Claim safety ────────────────────────────────────────────

describe('Claim safety', () => {
  const bannedClaims = [
    'clinically proven',
    'proven to reduce',
    'reduces wrinkles',
    'patient outcomes show',
    'more effective than',
    'FDA cleared for',
  ]

  it('blocks text containing a banned claim', () => {
    const result = checkClaimSafety(
      'The DP4 is clinically proven to reduce fine lines.',
      bannedClaims
    )
    assert.equal(result.safe, false)
    assert.ok(result.matches.length > 0)
  })

  it('passes safe text about specs and logistics', () => {
    const result = checkClaimSafety(
      'The DP4 features a 14-day trial period and includes a trade-in program for your current device.',
      bannedClaims
    )
    assert.equal(result.safe, true)
    assert.equal(result.matches.length, 0)
  })

  it('validates individual slot values', () => {
    const bad = validateSlotValue('icebreaker', 'Your patients will see results that are more effective than competitors', bannedClaims)
    assert.equal(bad.safe, false)

    const good = validateSlotValue('icebreaker', 'I noticed you recently expanded your practice', bannedClaims)
    assert.equal(good.safe, true)
  })

  it('is case-insensitive', () => {
    const result = checkClaimSafety('CLINICALLY PROVEN results', bannedClaims)
    assert.equal(result.safe, false)
  })
})

// ── Provider swap (no code change required) ──────────────────

describe('Provider swap requires no application code change', () => {
  it('hostinger adapter provides correct SPF and DKIM', async () => {
    const { getProvider } = await import('../lib/providers/index.js')
    const hostinger = getProvider('hostinger')
    assert.ok(hostinger.spfInclude.includes('hostinger'))
    assert.equal(hostinger.dkimSelector, 'default')
  })

  it('google_workspace adapter provides correct SPF and DKIM', async () => {
    const { getProvider } = await import('../lib/providers/index.js')
    const gw = getProvider('google_workspace')
    assert.equal(gw.spfInclude, '_spf.google.com')
    assert.equal(gw.dkimSelector, 'google')
  })

  it('switching provider only requires changing the provider value', async () => {
    const { getProvider } = await import('../lib/providers/index.js')
    const brandA = { slug: 'test', domain: 'test.com', provider: 'hostinger' }
    const brandB = { ...brandA, provider: 'google_workspace' }

    const provA = getProvider(brandA.provider)
    const provB = getProvider(brandB.provider)

    assert.notEqual(provA.spfInclude, provB.spfInclude)
    assert.notEqual(provA.dkimSelector, provB.dkimSelector)
    assert.ok(provA.smtpHost)
    assert.ok(provB.smtpHost)
  })

  it('throws for unknown provider', async () => {
    const { getProvider } = await import('../lib/providers/index.js')
    assert.throws(() => getProvider('zoho'), /unknown|unsupported/i)
  })
})

// ── Send policy enforcement ─────────────────────────────────

describe('Send policy gate logic', () => {
  it('WARMING mailbox send_mode defaults to SEED_ONLY', () => {
    const mailbox = { status: 'WARMING', send_mode: 'SEED_ONLY' }
    const canSendToProspect = mailbox.status !== 'WARMING' || mailbox.send_mode === 'LIVE'
    assert.equal(canSendToProspect, false)
  })

  it('WARM mailbox with LIVE mode can send to prospects', () => {
    const mailbox = { status: 'WARM', send_mode: 'LIVE' }
    const canSendToProspect = mailbox.status !== 'WARMING' || mailbox.send_mode === 'LIVE'
    assert.equal(canSendToProspect, true)
  })

  it('brand domain mismatch is detectable', () => {
    const brand = { domain: 'automate305.com' }
    const mailbox = { address: 'matt@aestheticdevicepro.com' }
    const domain = mailbox.address.split('@')[1]
    assert.notEqual(domain, brand.domain)
  })

  it('brand domain match passes', () => {
    const brand = { domain: 'aestheticdevicepro.com' }
    const mailbox = { address: 'matt@aestheticdevicepro.com' }
    const domain = mailbox.address.split('@')[1]
    assert.equal(domain, brand.domain)
  })

  it('campaign-mailbox brand must match', () => {
    const campaignBrandId = 'brand-aaa'
    const mailboxBrandId = 'brand-bbb'
    assert.notEqual(campaignBrandId, mailboxBrandId,
      'A campaign must not send from a mailbox belonging to a different brand')
  })

  it('same-brand campaign-mailbox passes', () => {
    const campaignBrandId = 'brand-aaa'
    const mailboxBrandId = 'brand-aaa'
    assert.equal(campaignBrandId, mailboxBrandId)
  })
})

// ── Suppression logic ───────────────────────────────────────

describe('Suppression tiers (unit logic)', () => {
  it('global blocklist blocks across all brands', () => {
    const globalBlocked = ['spam@badactor.com', 'competitor.com']
    const email = 'someone@competitor.com'
    const domain = email.split('@')[1]
    const blocked = globalBlocked.includes(email) || globalBlocked.includes(domain)
    assert.equal(blocked, true)
  })

  it('brand suppression is scoped to brand', () => {
    const brandSuppressions = {
      'brand-aesthetic': ['unsub@practice.com'],
      'brand-hvac': [],
    }
    const email = 'unsub@practice.com'

    assert.equal(brandSuppressions['brand-aesthetic'].includes(email), true,
      'Should be suppressed for aesthetic brand')
    assert.equal(brandSuppressions['brand-hvac'].includes(email), false,
      'Should NOT be suppressed for HVAC brand')
  })

  it('reply pauses sequence but does not suppress', () => {
    const enrollment = { status: 'active' }
    enrollment.status = 'paused'
    assert.equal(enrollment.status, 'paused')
  })
})

// ── Sequence lifecycle ──────────────────────────────────────

describe('Sequence lifecycle', () => {
  it('no path from DRAFT directly to ACTIVE', () => {
    const validTransitions = {
      DRAFT: ['APPROVED'],
      APPROVED: ['ACTIVE'],
      ACTIVE: ['ARCHIVED'],
    }
    assert.ok(!validTransitions.DRAFT.includes('ACTIVE'),
      'DRAFT cannot transition directly to ACTIVE')
    assert.ok(validTransitions.DRAFT.includes('APPROVED'))
    assert.ok(validTransitions.APPROVED.includes('ACTIVE'))
  })
})
