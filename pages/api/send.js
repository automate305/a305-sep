// ============================================================
// Automate305 SEP · /api/send.js
// Vercel serverless function — receives daily trigger,
// pulls today's queue from Supabase, then routes SMTP by sender domain:
// Google Workspace for automate305.com and Hostinger for aestheticdevicepro.com.
//
// Multi-campaign: each queue item carries its sequence's campaign
// ('aesthetic' | 'hvac') and a sender is picked from the SAME campaign,
// so HVAC mail never goes out from the aesthetic mailboxes.
// ============================================================

import { randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import { campaignAutomationEnabled, campaignBlockedBySurbl } from '../../lib/services/campaign-launch.js'
import { outboxRunRecord, recordOutboxRun, resetSendsForEasternDay } from '../../lib/services/outbox-run-log.js'
import { rampCapForSendingDay, sendingDayFromHistory } from '../../lib/services/send-ramp.js'
import { threadHeaders } from '../../lib/services/send-thread.js'
import { createSenderGate, senderPoolAtCapacity } from '../../lib/services/sender-gate.js'
import { createSmtpTransporter } from '../../lib/services/smtp.js'
import { buildEmailFooter } from '../../lib/services/email-footer.js'
import { blockingSuppression, loadSuppressionRows } from '../../lib/services/send-block.js'
import { isPermanentRecipientFailure } from '../../lib/services/smtp-failure.js'
import { stopContactForBounce } from '../../lib/services/stop-contact.js'
import { getTrackingConfig, prepareTracking } from '../../lib/services/tracking.js'
import { buildUnsubscribeUrl, getUnsubscribeSigningKey } from '../../lib/services/suppression.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service role key — never anon
)

const MAX_STEP_FALLBACK = 10   // safety bound if a template lookup ever fails

// ── TEMPLATE MERGE ───────────────────────────────────────────
// Supports both the aesthetic variables (practice_name, sender_name) and
// the HVAC/ColdIQ variables (company, signature, personalized_line, etc.).
function mergeTemplate(text, contact, sender) {
  const area = contact.area || contact.city || 'South Florida'
  const fallbackPersonalizedParagraph = contact.campaign === 'aesthetic'
    ? `I came across ${contact.practice_name || 'your practice'} while reviewing local aesthetics teams.`
    : 'I came across your company while looking at HVAC shops in the area.'
  return (text || '')
    .replace(/{{first_name}}/g,             contact.first_name    || 'there')
    .replace(/{{last_name}}/g,              contact.last_name     || '')
    .replace(/{{practice_name}}/g,          contact.practice_name || 'your practice')
    .replace(/{{company}}/g,                contact.company || contact.practice_name || 'your company')
    .replace(/{{sender_name}}/g,            sender.name)
    .replace(/{{signature}}/g,              sender.signature || sender.name)
    .replace(/{{personalized_line}}/g,      contact.personalized_line ||
             'I came across your company while looking at HVAC shops in the area.')
    .replace(/{{personalized_paragraph}}/g, contact.personalized_paragraph ||
             contact.personalized_line ||
             fallbackPersonalizedParagraph)
    .replace(/{{pain_point}}/g,             contact.pain_point || 'scheduling and dispatch')
    .replace(/{{area}}/g,                   area)
    .replace(/{{website_observation}}/g,    contact.website_observation ||
             'There are a few quick wins that could help it convert more visitors into booked calls.')
}

async function applyRamp(senders) {
  const ids = (senders || []).map((sender) => sender.id).filter(Boolean)
  let history = []
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('send_log')
      .select('sender_id,sent_at')
      .in('sender_id', ids)
      .eq('status', 'sent')
    if (error) throw new Error(`Ramp history lookup failed: ${error.message}`)
    history = data || []
  }

  return (senders || []).map((sender) => {
    const sentAtValues = history
      .filter((row) => row.sender_id === sender.id)
      .map((row) => row.sent_at)
    const sendingDay = sendingDayFromHistory({
      sentAtValues,
      warmedAt: sender.warmed_at
    })
    return {
      ...sender,
      ramp_cap: rampCapForSendingDay(sendingDay),
      sending_day: sendingDay
    }
  })
}

// Warming mailboxes are ignored when the campaign has a warmed sender.
// They are passed through only when none are warmed, so the refusal still
// names the mailboxes that are not ready.
async function pickSender(gate, campaign) {
  let query = supabase
    .from('senders')
    .select('*')
    .order('sends_today', { ascending: true })

  if (campaign) query = query.eq('campaign', campaign)

  const { data, error } = await query

  if (error) throw new Error(`Sender lookup failed: ${error.message}`)

  const rows = data || []
  const warmed = rows.filter((sender) => sender.warmed)
  return gate.selectSender(await applyRamp(warmed.length > 0 ? warmed : rows), campaign)
}

async function stepOneThread(enrollmentId) {
  const { data, error } = await supabase
    .from('send_log')
    .select('sender_id,message_id')
    .eq('enrollment_id', enrollmentId)
    .eq('step', 1)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (/message_id/.test(error.message || '')) return { error, missingColumn: true }
    throw new Error('Step 1 thread lookup failed. No email was sent.')
  }
  return { thread: data }
}

// ── ADVANCE ENROLLMENT (N-step, correct per-step delay) ──────
// Looks up the NEXT step's template to decide whether the sequence is
// finished and, if not, how many days until that next step goes out
// (delay_days = days after the previous step).
async function advanceEnrollment(enrollmentId, sequenceId, currentStep) {
  const nextStep = currentStep + 1

  const { data: nextTpl } = await supabase
    .from('templates')
    .select('delay_days')
    .eq('sequence_id', sequenceId)
    .eq('step', nextStep)
    .maybeSingle()

  if (!nextTpl || nextStep > MAX_STEP_FALLBACK) {
    // No further step → sequence complete
    await supabase
      .from('enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollmentId)
    return
  }

  const nextDate = new Date()
  nextDate.setDate(nextDate.getDate() + (nextTpl.delay_days || 0))

  await supabase
    .from('enrollments')
    .update({
      current_step:   nextStep,
      next_send_date: nextDate.toISOString().split('T')[0]
    })
    .eq('id', enrollmentId)
}

function countResults(results) {
  return {
    failed: results?.failed?.length || 0,
    sent: results?.sent?.length || 0,
    skipped: results?.skipped?.length || 0
  }
}

function campaignFromRequest(req) {
  const queryCampaign = typeof req.query?.campaign === 'string' ? req.query.campaign : ''
  const bodyCampaign = typeof req.body?.campaign === 'string' ? req.body.campaign : ''
  return (queryCampaign || bodyCampaign).trim()
}

// ── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {
  async function finish(statusCode, body, meta) {
    await recordOutboxRun(supabase, outboxRunRecord({
      campaign: meta.campaign ?? null,
      counts: meta.counts || countResults(body.results),
      details: body,
      job: 'send',
      status: meta.status,
      stopReason: meta.stopReason ?? null
    }))
    return res.status(statusCode).json(body)
  }

  function logOnly(statusCode, body, meta) {
    console.log(JSON.stringify(outboxRunRecord({
      campaign: meta.campaign ?? null,
      counts: meta.counts || {},
      details: body,
      job: 'send',
      status: meta.status,
      stopReason: meta.stopReason ?? null
    })))
    return res.status(statusCode).json(body)
  }

  // Auth check — shared secret between Cowork trigger and this webhook
  const secret = req.headers['x-a305-secret']
  if (secret !== process.env.WEBHOOK_SECRET) {
    return logOnly(401, { error: 'Unauthorized' }, {
      status: 'error',
      stopReason: 'Unauthorized'
    })
  }

  if (req.method !== 'POST') {
    return logOnly(405, { error: 'Method not allowed' }, {
      status: 'error',
      stopReason: 'Method not allowed'
    })
  }

  const requestedCampaign = campaignFromRequest(req)
  if (requestedCampaign && !/^[a-z0-9_]+$/.test(requestedCampaign)) {
    return logOnly(400, { error: 'Invalid campaign filter' }, {
      campaign: null,
      status: 'error',
      stopReason: 'Invalid campaign filter'
    })
  }

  const results = { sent: [], failed: [], skipped: [] }

  // One gate for this request: every send below is decided by it, and
  // each mailbox is verified over SMTP at most once.
  const gate = createSenderGate()

  // Where the unsubscribe link points. PUBLIC_BASE_URL wins; otherwise the
  // request's own origin, so a preview deployment links to itself rather than
  // to production. Without a signing key no one-click link can be minted and
  // the mail falls back to the reply-to instruction.
  const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host
  const forwardedProtocol = req.headers['x-forwarded-proto'] || 'https'
  const unsubscribeOrigin = getUnsubscribeSigningKey()
    ? (process.env.PUBLIC_BASE_URL ||
       (forwardedHost ? `${forwardedProtocol}://${forwardedHost}` : null))
    : null

  if (!unsubscribeOrigin) {
    console.warn('No one-click unsubscribe link: set UNSUBSCRIBE_SECRET and PUBLIC_BASE_URL')
  }

  try {
    // Same ET-date reset as the weekday cron. A manual send on a new day
    // must not keep yesterday's counter, and a second send today must not
    // zero mail that already went out. Missing the new column is a warning,
    // not a wipe of every mailbox.
    const reset = await resetSendsForEasternDay(supabase, { allowLegacyRpc: false })
    if (!reset.ok && !reset.missingColumn) {
      return finish(503, { error: 'Unable to reset daily sender counts.', reset }, {
        campaign: requestedCampaign || null,
        status: 'error',
        stopReason: reset.error || 'Unable to reset daily sender counts.'
      })
    }

    // 1. Pull today's queue
    const { data: queue, error: qErr } = await supabase
      .from('todays_queue')
      .select('*')

    if (qErr) throw qErr
    const campaignQueue = requestedCampaign
      ? (queue || []).filter((item) => item.campaign === requestedCampaign)
      : queue || []
    if (campaignQueue.length === 0) {
      return finish(200, { message: 'Nothing in queue today', reset, results }, {
        campaign: requestedCampaign || null,
        status: 'ok',
        stopReason: 'Nothing in queue today'
      })
    }

    const { data: campaignSenders, error: senderError } = await supabase
      .from('senders')
      .select('campaign,email')
    if (senderError) throw new Error('Unable to load sending domains. No email was sent.')

    const campaignsInQueue = [...new Set(campaignQueue.map((item) => item.campaign).filter(Boolean))]
    const blockedCampaignReasons = new Map()
    const blocklistWarnings = []
    for (const campaign of campaignsInQueue) {
      if (!campaignAutomationEnabled(campaign)) {
        blockedCampaignReasons.set(campaign, 'Campaign automation is off')
        continue
      }
      const listing = await campaignBlockedBySurbl(campaign, campaignSenders)
      if (listing.warnings?.length) blocklistWarnings.push({ campaign, warnings: listing.warnings })
      if (listing.blocked) blockedCampaignReasons.set(campaign, listing.reason)
    }

    const contactIds = [...new Set(campaignQueue.map((item) => item.contact_id).filter(Boolean))]
    if (contactIds.length === 0) throw new Error('Queue rows are missing contact ids. No email was sent.')
    const { data: contactFlags, error: flagError } = await supabase
      .from('contacts')
      .select('id,bounced,unsubscribed')
      .in('id', contactIds)
    if (flagError) throw new Error('Contact suppression lookup failed. No email was sent.')
    const flagsById = new Map((contactFlags || []).map((contact) => [contact.id, contact]))
    const suppressionRows = await loadSuppressionRows(
      supabase,
      campaignQueue.map((item) => item.email)
    )

    console.log(`📬 Queue: ${campaignQueue.length} emails to process`)

    const exhaustedCampaigns = new Set()

    // 2. Process each enrollment
    for (const item of campaignQueue) {
      let usingSticky = false

      try {
        if (exhaustedCampaigns.has(item.campaign)) {
          results.skipped.push({ email: item.email, reason: 'All mailboxes are at capacity' })
          continue
        }

        const listingReason = blockedCampaignReasons.get(item.campaign)
        if (listingReason) {
          results.skipped.push({ email: item.email, reason: listingReason })
          continue
        }

        const flags = flagsById.get(item.contact_id)
        const blocked = flags?.bounced
          ? { reason: 'Contact is bounced', status: 'bounced' }
          : flags?.unsubscribed
            ? { reason: 'Contact is unsubscribed', status: 'unsubscribed' }
            : blockingSuppression(suppressionRows, item.email, item.campaign)

        if (blocked) {
          await supabase
            .from('enrollments')
            .update({
              completed_at: new Date().toISOString(),
              held_at: null,
              hold_reason: null,
              status: blocked.status
            })
            .eq('id', item.enrollment_id)
            .in('status', ['active', 'held', 'paused'])
          results.skipped.push({ email: item.email, reason: blocked.reason })
          continue
        }

        // Step 1 picks the least-used warmed mailbox. Later steps stay on
        // that mailbox and thread to its Message-ID.
        const step = Number(item.step || 1)
        let sender
        let replyHeaders = {}
        if (step > 1) {
          usingSticky = true
          const prior = await stepOneThread(item.enrollment_id)
          if (prior.missingColumn || !prior.thread?.sender_id || !prior.thread?.message_id) {
            results.skipped.push({
              email: item.email,
              reason: 'Follow-up has no step-1 sender to continue'
            })
            continue
          }
          const { data: stickySender, error: stickyError } = await supabase
            .from('senders')
            .select('*')
            .eq('id', prior.thread.sender_id)
            .maybeSingle()
          if (stickyError || !stickySender) {
            results.skipped.push({ email: item.email, reason: 'Follow-up sender is no longer available' })
            continue
          }
          const [ramped] = await applyRamp([stickySender])
          sender = await gate.selectSender([ramped], item.campaign)
          replyHeaders = threadHeaders(prior.thread.message_id)
        } else {
          sender = await pickSender(gate, item.campaign)
        }

        // Merge template
        const subject = mergeTemplate(item.subject, item, sender).toLowerCase()
        let body = mergeTemplate(item.body_text, item, sender)

        // Fail closed before SMTP if a template contains an unknown merge field.
        const subjectWordCount = subject.split(/\s+/).filter(Boolean).length
        if (/{{[^}]+}}/.test(subject) || /{{[^}]+}}/.test(body) || body.includes('—') || subjectWordCount < 3 || subjectWordCount > 4) {
          await supabase
            .from('enrollments')
            .update({
              status: 'held',
              hold_reason: 'Template failed copy safeguards',
              held_at: new Date().toISOString()
            })
            .eq('id', item.enrollment_id)
          results.skipped.push({
            email: item.email,
            reason: 'Template failed copy safeguards'
          })
          continue
        }

        // Replies route to the sender's configured inbox (aliases → main box)
        const replyTo = sender.reply_to || sender.email
        const unsubMailto = `mailto:${replyTo}?subject=unsubscribe`

        // RFC 8058 one-click needs an https URI in List-Unsubscribe. Declaring
        // List-Unsubscribe-Post against a mailto alone is invalid, and Gmail
        // shows no native unsubscribe control for it — which is what the old
        // header did. The https link is offered first, mailto as the fallback.
        const unsubUrl = unsubscribeOrigin
          ? buildUnsubscribeUrl(item.email, unsubscribeOrigin)
          : null
        const listUnsubscribeHeaders = unsubUrl
          ? {
              'List-Unsubscribe': `<${unsubUrl}>, <${unsubMailto}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
          : { 'List-Unsubscribe': `<${unsubMailto}>` }

        // No postal address for this brand means no send: hold, never mail without one.
        const footer = buildEmailFooter({ campaign: item.campaign, unsubscribeUrl: unsubUrl })
        if (footer === null) {
          await supabase
            .from('enrollments')
            .update({
              status: 'held',
              hold_reason: 'No sender postal address configured for this brand',
              held_at: new Date().toISOString()
            })
            .eq('id', item.enrollment_id)
          results.skipped.push({
            email: item.email,
            reason: 'No sender postal address configured for this brand'
          })
          continue
        }

        // Optional open/click tracking. Off unless TRACKER_API_KEY is set and this
        // sender's domain is in TRACKER_DOMAINS; any tracker failure sends the
        // message untracked. The send_log id is generated first and doubles as
        // the tracker's message id, so tracker events join straight to the send.
        // (Not the SMTP Message-ID, which send_log.message_id records for
        // threading.) The footer and unsubscribe link are never rewritten.
        const sendLogId = randomUUID()
        const tracking = await prepareTracking({
          config: getTrackingConfig(sender.email),
          messageId: sendLogId,
          recipient: item.email,
          campaign: item.campaign,
          body,
          footer
        })
        body = tracking.body

        // Route Automate305 through Google Workspace and Aesthetic through Hostinger.
        const transporter = createSmtpTransporter(sender)
        const sentInfo = await transporter.sendMail({
          from:    `"${sender.name}" <${sender.email}>`,
          to:      item.email,
          subject: subject,
          text:    body + footer,
          ...(tracking.html ? { html: tracking.html } : {}),
          replyTo: replyTo,
          headers: { ...listUnsubscribeHeaders, ...replyHeaders }
        })

        // Log the send. If the threading column is not migrated yet, keep
        // the row so this message is not retried as a brand-new first touch.
        // `id` is the tracking id; `message_id` below is the SMTP Message-ID.
        const logRow = {
          id:            sendLogId,
          enrollment_id: item.enrollment_id,
          contact_id:    item.contact_id,
          sender_id:     sender.id,
          step:          item.step,
          subject:       subject,
          status:        'sent',
          message_id:    sentInfo?.messageId || null
        }
        const inserted = await supabase.from('send_log').insert(logRow)
        if (inserted.error && /message_id/.test(inserted.error.message || '')) {
          const withoutMessageId = { ...logRow }
          delete withoutMessageId.message_id
          await supabase.from('send_log').insert(withoutMessageId)
        }
        if (sender.warmed && !sender.warmed_at) {
          await supabase
            .from('senders')
            .update({ warmed_at: new Date().toISOString() })
            .eq('id', sender.id)
            .is('warmed_at', null)
        }

        // Increment sender's daily count
        await supabase
          .from('senders')
          .update({ sends_today: sender.sends_today + 1 })
          .eq('id', sender.id)

        // Advance enrollment to next step (or complete)
        await advanceEnrollment(item.enrollment_id, item.sequence_id, item.step)

        results.sent.push({ email: item.email, step: item.step, campaign: item.campaign, sender: sender.email })
        console.log(`✅ Sent step ${item.step} (${item.campaign}) to ${item.email} via ${sender.email}`)

        // Throttle — 3s between sends to avoid SMTP rate limits
        await new Promise(r => setTimeout(r, 3000))

      } catch (sendErr) {
        console.error(`❌ Failed: ${item.email}`, sendErr.message)

        if (senderPoolAtCapacity(sendErr)) {
          if (!usingSticky) exhaustedCampaigns.add(item.campaign)
          results.skipped.push({
            email: item.email,
            reason: usingSticky ? 'Sending mailbox is at capacity' : 'All mailboxes are at capacity'
          })
          continue
        }

        if (isPermanentRecipientFailure(sendErr)) {
          try {
            await stopContactForBounce(
              supabase,
              item.email,
              `Permanent SMTP refusal ${sendErr.responseCode}`
            )
            await supabase.from('send_log').insert({
              enrollment_id: item.enrollment_id,
              contact_id:    item.contact_id,
              step:          item.step,
              status:        'bounced',
              error_message: 'Permanent recipient refusal'
            })
            results.failed.push({ email: item.email, error: 'Permanent recipient refusal' })
          } catch {
            await supabase.from('enrollments').update({
              held_at: new Date().toISOString(),
              hold_reason: 'Permanent SMTP failure needs review',
              status: 'held'
            }).eq('id', item.enrollment_id)
            results.failed.push({ email: item.email, error: 'Permanent recipient refusal could not be recorded' })
          }
          continue
        }

        // Log failure
        await supabase.from('send_log').insert({
          enrollment_id: item.enrollment_id,
          contact_id:    item.contact_id,
          step:          item.step,
          status:        'failed',
          error_message: sendErr.message
        })

        results.failed.push({ email: item.email, error: sendErr.message })
      }
    }

    const sentCount = results.sent.length
    return finish(200, {
      blocklistWarnings,
      message: `Done. ${sentCount} sent, ${results.failed.length} failed.`,
      reset,
      results
    }, {
      campaign: requestedCampaign || null,
      counts: countResults(results),
      status: sentCount > 0 ? 'ok' : 'stopped',
      stopReason: sentCount > 0 ? null : 'No email was sent.'
    })

  } catch (err) {
    console.error('Handler error:', err)
    return finish(500, { error: err.message }, {
      campaign: requestedCampaign || null,
      status: 'error',
      stopReason: err.message || 'Send failed.'
    })
  }
}
