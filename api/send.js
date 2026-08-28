// ============================================================
// Automate305 SEP · /api/send.js
// Vercel serverless function — receives daily trigger,
// pulls today's queue from Supabase, sends via Hostinger SMTP.
//
// Multi-campaign: each queue item carries its sequence's campaign
// ('aesthetic' | 'hvac') and a sender is picked from the SAME campaign,
// so HVAC mail never goes out from the aesthetic mailboxes.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service role key — never anon
)

const MAX_STEP_FALLBACK = 10   // safety bound if a template lookup ever fails

// ── HOSTINGER SMTP CONFIG ────────────────────────────────────
// One transporter per sender (Hostinger requires auth per mailbox)
function makeTransporter(sender) {
  return nodemailer.createTransport({
    host:   sender.host || 'smtp.hostinger.com',
    port:   sender.port || 465,
    secure: (sender.port || 465) === 465,   // 465 = implicit SSL
    auth: {
      user: sender.email,
      pass: process.env[passEnvVar(sender.email)]
      // Env var naming: matt@ → SMTP_PASS_MATT, cam@ → SMTP_PASS_CAM, etc.
    }
  })
}

function passEnvVar(email) {
  return `SMTP_PASS_${email.split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

// ── TEMPLATE MERGE ───────────────────────────────────────────
// Supports both the aesthetic variables (practice_name, sender_name) and
// the HVAC/ColdIQ variables (company, signature, personalized_line, etc.).
function mergeTemplate(text, contact, sender) {
  const area = contact.area || contact.city || 'South Florida'
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
             'I came across your company while looking at HVAC shops in the area.')
    .replace(/{{pain_point}}/g,             contact.pain_point || 'scheduling and dispatch')
    .replace(/{{area}}/g,                   area)
    .replace(/{{website_observation}}/g,    contact.website_observation ||
             'There are a few quick wins that could help it convert more visitors into booked calls.')
}

// ── PICK AVAILABLE SENDER (campaign-scoped) ──────────────────
async function pickSender(campaign) {
  let query = supabase
    .from('senders')
    .select('*')
    .eq('active', true)
    .order('sends_today', { ascending: true })
    .limit(1)

  if (campaign) query = query.eq('campaign', campaign)

  const { data, error } = await query
  const sender = data && data[0]

  if (error) throw new Error(`Sender lookup failed: ${error.message}`)
  if (!sender) throw new Error(`No active senders for campaign "${campaign}"`)
  if (sender.sends_today >= sender.daily_limit) {
    throw new Error(`Daily limit reached for campaign "${campaign}" (all senders maxed)`)
  }
  return sender
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

// ── MAIN HANDLER ─────────────────────────────────────────────
export default async function handler(req, res) {

  // Auth check — shared secret between Cowork trigger and this webhook
  const secret = req.headers['x-a305-secret']
  if (secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const results = { sent: [], failed: [], skipped: [] }

  try {
    // 1. Pull today's queue
    const { data: queue, error: qErr } = await supabase
      .from('todays_queue')
      .select('*')

    if (qErr) throw qErr
    if (!queue || queue.length === 0) {
      return res.status(200).json({ message: 'Nothing in queue today', results })
    }

    console.log(`📬 Queue: ${queue.length} emails to process`)

    // 2. Process each enrollment
    for (const item of queue) {

      try {
        // Pick a sender with capacity, scoped to this item's campaign
        const sender = await pickSender(item.campaign)

        // Merge template
        const subject = mergeTemplate(item.subject,   item, sender)
        const body    = mergeTemplate(item.body_text, item, sender)

        // Replies route to the sender's configured inbox (aliases → main box)
        const replyTo = sender.reply_to || sender.email
        // One-click list-unsubscribe (RFC 8058) → routes to the reply inbox
        const unsubMailto = `mailto:${replyTo}?subject=unsubscribe`

        const footer =
          `\n\n---\nDon't want to hear from me? Reply "unsubscribe" and I'll ` +
          `take you off the list.`

        // Send via Hostinger SMTP
        const transporter = makeTransporter(sender)
        await transporter.sendMail({
          from:    `"${sender.name}" <${sender.email}>`,
          to:      item.email,
          subject: subject,
          text:    body + footer,
          replyTo: replyTo,
          headers: {
            'List-Unsubscribe':      `<${unsubMailto}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          }
        })

        // Log the send
        await supabase.from('send_log').insert({
          enrollment_id: item.enrollment_id,
          contact_id:    item.contact_id,
          sender_id:     sender.id,
          step:          item.step,
          subject:       subject,
          status:        'sent'
        })

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

    return res.status(200).json({
      message: `Done. ${results.sent.length} sent, ${results.failed.length} failed.`,
      results
    })

  } catch (err) {
    console.error('Handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
