// ============================================================
// Automate305 SEP · /api/send.js
// Vercel serverless function — receives daily trigger,
// pulls today's queue from Supabase, sends via Hostinger SMTP
// ============================================================

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service role key — never anon
)

// ── HOSTINGER SMTP CONFIG ────────────────────────────────────
// One transporter per sender (Hostinger requires auth per mailbox)
function makeTransporter(senderEmail) {
  return nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true,   // SSL
    auth: {
      user: senderEmail,
      pass: process.env[`SMTP_PASS_${senderEmail.split('@')[0].toUpperCase().replace(/[^A-Z]/g, '_')}`]
      // Env var naming: matt@ → SMTP_PASS_MATT, don@ → SMTP_PASS_DON, etc.
    }
  })
}

// ── TEMPLATE MERGE ───────────────────────────────────────────
function mergeTemplate(text, contact, sender) {
  return text
    .replace(/{{first_name}}/g,    contact.first_name    || 'there')
    .replace(/{{last_name}}/g,     contact.last_name     || '')
    .replace(/{{practice_name}}/g, contact.practice_name || 'your practice')
    .replace(/{{sender_name}}/g,   sender.name)
}

// ── PICK AVAILABLE SENDER ────────────────────────────────────
async function pickSender() {
  const { data, error } = await supabase
    .from('available_senders')
    .select('*')
    .limit(1)
    .single()

  if (error || !data) throw new Error('No available senders today — limit reached or all inactive')
  return data
}

// ── ADVANCE ENROLLMENT ───────────────────────────────────────
async function advanceEnrollment(enrollmentId, currentStep, delayDays) {
  const nextStep = currentStep + 1
  const nextDate = new Date()
  nextDate.setDate(nextDate.getDate() + delayDays)

  if (nextStep > 3) {
    // Sequence complete
    await supabase
      .from('enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', enrollmentId)
  } else {
    await supabase
      .from('enrollments')
      .update({
        current_step:   nextStep,
        next_send_date: nextDate.toISOString().split('T')[0]
      })
      .eq('id', enrollmentId)
  }
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
        // Pick a sender with capacity
        const sender = await pickSender()

        // Merge template
        const subject = mergeTemplate(item.subject,   item, sender)
        const body    = mergeTemplate(item.body_text, item, sender)

        // Send via Hostinger SMTP
        const transporter = makeTransporter(sender.email)
        await transporter.sendMail({
          from:    `"${sender.name}" <${sender.email}>`,
          to:      item.email,
          subject: subject,
          text:    body,
          // Reply-to routes back to the correct main inbox
          replyTo: sender.email.includes('tamiko') || ['jen','jenny','jess','jessica','tami'].some(a => sender.email.startsWith(a))
            ? 'tamiko@aestheticdevicepro.com'
            : 'matt@aestheticdevicepro.com'
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

        // Advance enrollment to next step
        await advanceEnrollment(item.enrollment_id, item.step, item.delay_days)

        results.sent.push({ email: item.email, step: item.step, sender: sender.email })
        console.log(`✅ Sent step ${item.step} to ${item.email} via ${sender.email}`)

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
