import nodemailer from 'nodemailer'
import { supabase } from './supabase.js'
import { getProvider } from './providers/index.js'
import { isSuppressed, isContactInActiveSequence } from './suppression.js'
import {
  mergeTemplate, hasUnresolvedPlaceholders, checkSpamPhrases,
  buildUnsubscribeFooter, buildListUnsubscribeHeaders
} from './merge.js'

export async function isKillSwitchOn() {
  const { data } = await supabase
    .from('global_settings')
    .select('value')
    .eq('key', 'kill_switch')
    .single()
  return data?.value === true
}

export async function getSendWindow() {
  const { data: rows } = await supabase
    .from('global_settings')
    .select('key, value')
    .in('key', ['send_window_start_hour', 'send_window_end_hour', 'send_window_timezone'])

  const settings = {}
  for (const r of (rows || [])) settings[r.key] = r.value
  return {
    startHour: settings.send_window_start_hour ?? 9,
    endHour: settings.send_window_end_hour ?? 17,
    timezone: settings.send_window_timezone ?? 'America/New_York',
  }
}

export function isWithinSendWindow(sendWindow) {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: sendWindow.timezone,
    hour: 'numeric',
    hour12: false,
  })
  const hour = parseInt(formatter.format(now), 10)
  return hour >= sendWindow.startHour && hour < sendWindow.endHour
}

function randomDelayMs(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs
}

export async function buildQueue() {
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      id, contact_id, sequence_id, brand_id, campaign_id,
      current_step, next_send_date, status,
      contacts (id, email, first_name, last_name, practice_name, company,
                title, phone, city, state, personalized_line,
                personalized_paragraph, pain_point, area, website_observation, tags)
    `)
    .eq('status', 'active')
    .lte('next_send_date', new Date().toISOString().split('T')[0])

  if (!enrollments || enrollments.length === 0) return []

  const queueItems = []

  for (const enr of enrollments) {
    const contact = enr.contacts
    if (!contact) continue

    const suppression = await isSuppressed(contact.email, enr.brand_id)
    if (suppression.suppressed) continue

    const { data: step } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enr.sequence_id)
      .eq('step_number', enr.current_step)
      .single()

    if (!step) continue

    const { data: mailbox } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('brand_id', enr.brand_id)
      .eq('active', true)
      .neq('send_mode', 'OFF')
      .order('sends_today', { ascending: true })
      .limit(1)
      .single()

    if (!mailbox) continue

    if (mailbox.status === 'WARMING' && mailbox.send_mode === 'SEED_ONLY') continue

    if (mailbox.sends_today >= mailbox.daily_cap) continue

    const merged = mergeTemplate(step.subject_template, contact, mailbox)
    const mergedBody = mergeTemplate(step.body_template, contact, mailbox)

    let holdReason = null

    const placeholderCheck = hasUnresolvedPlaceholders(merged + ' ' + mergedBody)
    if (!placeholderCheck.clean) {
      holdReason = `Unresolved placeholders: ${placeholderCheck.placeholders.join(', ')}`
    }

    const spamCheck = checkSpamPhrases(merged + ' ' + mergedBody)
    if (!spamCheck.clean) {
      holdReason = (holdReason ? holdReason + '; ' : '') +
        `Spam phrases: ${spamCheck.phrases.join(', ')}`
    }

    const isHighValue = contact.tags &&
      (Array.isArray(contact.tags) ? contact.tags : []).includes('high_value')
    if (isHighValue && enr.current_step === 1) {
      holdReason = (holdReason ? holdReason + '; ' : '') +
        'First touch to high-value contact'
    }

    const hasReplied = await hasContactRepliedBefore(contact.id, enr.brand_id)
    if (hasReplied) {
      holdReason = (holdReason ? holdReason + '; ' : '') +
        'Contact previously replied'
    }

    const inOtherSequence = await isContactInActiveSequence(
      contact.id, enr.brand_id, enr.campaign_id
    )
    if (inOtherSequence) continue

    const sendWindow = await getSendWindow()
    const windowStart = new Date()
    windowStart.setHours(sendWindow.startHour, 0, 0, 0)
    const windowEnd = new Date()
    windowEnd.setHours(sendWindow.endHour, 0, 0, 0)

    const scheduledAt = new Date(
      windowStart.getTime() + Math.random() * (windowEnd.getTime() - windowStart.getTime())
    )

    const status = holdReason ? 'HELD' : 'PENDING'
    const holdExpiresAt = holdReason
      ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      : null

    queueItems.push({
      enrollment_id: enr.id,
      contact_id: contact.id,
      mailbox_id: mailbox.id,
      brand_id: enr.brand_id,
      campaign_id: enr.campaign_id,
      sequence_id: enr.sequence_id,
      step_number: enr.current_step,
      subject: merged,
      body: mergedBody,
      scheduled_at: scheduledAt.toISOString(),
      status,
      hold_reason: holdReason,
      hold_expires_at: holdExpiresAt,
    })
  }

  if (queueItems.length > 0) {
    await supabase.from('send_queue').insert(queueItems)
  }

  return queueItems
}

async function hasContactRepliedBefore(contactId, brandId) {
  const { data } = await supabase
    .from('inbound_messages')
    .select('id')
    .eq('contact_id', contactId)
    .eq('brand_id', brandId)
    .eq('classification', 'REPLY')
    .limit(1)
  return (data && data.length > 0)
}

export async function processQueue() {
  if (await isKillSwitchOn()) {
    return { sent: [], failed: [], skipped: [], reason: 'Kill switch is on' }
  }

  const sendWindow = await getSendWindow()
  if (!isWithinSendWindow(sendWindow)) {
    return { sent: [], failed: [], skipped: [], reason: 'Outside send window' }
  }

  const now = new Date().toISOString()

  await supabase
    .from('send_queue')
    .update({ status: 'EXPIRED' })
    .eq('status', 'HELD')
    .lt('hold_expires_at', now)

  const { data: items } = await supabase
    .from('send_queue')
    .select('*, mailboxes (*), contacts (email)')
    .eq('status', 'PENDING')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (!items || items.length === 0) {
    return { sent: [], failed: [], skipped: [], reason: 'Queue empty' }
  }

  const results = { sent: [], failed: [], skipped: [] }
  const brandCache = {}

  for (const item of items) {
    try {
      const mailbox = item.mailboxes
      if (!mailbox || !mailbox.active || mailbox.send_mode === 'OFF') {
        results.skipped.push({ id: item.id, reason: 'Mailbox inactive or OFF' })
        await supabase.from('send_queue').update({ status: 'SKIPPED', error_message: 'Mailbox inactive' }).eq('id', item.id)
        continue
      }

      if (mailbox.sends_today >= mailbox.daily_cap) {
        results.skipped.push({ id: item.id, reason: 'Daily cap reached' })
        continue
      }

      if (mailbox.status === 'WARMING' && mailbox.send_mode !== 'LIVE') {
        results.skipped.push({ id: item.id, reason: 'WARMING mailbox cannot send to prospects' })
        await supabase.from('send_queue').update({ status: 'SKIPPED', error_message: 'WARMING: seed only' }).eq('id', item.id)
        continue
      }

      const suppression = await isSuppressed(item.contacts.email, item.brand_id)
      if (suppression.suppressed) {
        results.skipped.push({ id: item.id, reason: suppression.reason })
        await supabase.from('send_queue').update({ status: 'SKIPPED', error_message: suppression.reason }).eq('id', item.id)
        continue
      }

      const placeholderCheck = hasUnresolvedPlaceholders(item.subject + ' ' + item.body)
      if (!placeholderCheck.clean) {
        await supabase.from('send_queue').update({
          status: 'HELD',
          hold_reason: `Unresolved: ${placeholderCheck.placeholders.join(', ')}`,
          hold_expires_at: new Date(Date.now() + 48 * 3600000).toISOString()
        }).eq('id', item.id)
        continue
      }

      if (!brandCache[item.brand_id]) {
        const { data: brand } = await supabase.from('brands').select('*').eq('id', item.brand_id).single()
        brandCache[item.brand_id] = brand
      }
      const brand = brandCache[item.brand_id]
      const provider = getProvider(brand.provider)

      await supabase.from('send_queue').update({ status: 'SENDING' }).eq('id', item.id)

      const smtpAuth = provider.getSmtpAuth(mailbox.address, brand.slug)
      const transporter = nodemailer.createTransport({
        host: provider.smtpHost(brand.slug),
        port: provider.smtpPort(brand.slug),
        secure: provider.smtpSecure(brand.slug),
        auth: smtpAuth,
      })

      const replyTo = mailbox.reply_to || mailbox.address
      const footer = buildUnsubscribeFooter(replyTo)
      const unsubHeaders = buildListUnsubscribeHeaders(replyTo)

      const info = await transporter.sendMail({
        from: `"${mailbox.display_name}" <${mailbox.address}>`,
        to: item.contacts.email,
        subject: item.subject,
        text: item.body + footer,
        replyTo,
        headers: unsubHeaders,
      })

      const messageId = info.messageId

      await supabase.from('send_log').insert({
        enrollment_id: item.enrollment_id,
        contact_id: item.contact_id,
        mailbox_id: mailbox.id,
        brand_id: item.brand_id,
        sequence_id: item.sequence_id,
        step: item.step_number,
        subject: item.subject,
        message_id: messageId,
        status: 'sent',
      })

      await supabase
        .from('mailboxes')
        .update({ sends_today: mailbox.sends_today + 1 })
        .eq('id', mailbox.id)

      await advanceEnrollment(item.enrollment_id, item.sequence_id, item.step_number)

      await supabase.from('send_queue').update({
        status: 'SENT',
        sent_at: new Date().toISOString()
      }).eq('id', item.id)

      results.sent.push({
        id: item.id,
        email: item.contacts.email,
        step: item.step_number,
        mailbox: mailbox.address,
        messageId,
      })

      const delay = randomDelayMs(2000, 5000)
      await new Promise(r => setTimeout(r, delay))

    } catch (err) {
      await supabase.from('send_queue').update({
        status: 'FAILED',
        error_message: err.message
      }).eq('id', item.id)

      await supabase.from('send_log').insert({
        enrollment_id: item.enrollment_id,
        contact_id: item.contact_id,
        mailbox_id: item.mailbox_id,
        brand_id: item.brand_id,
        step: item.step_number,
        status: 'failed',
        error_message: err.message,
      })

      results.failed.push({ id: item.id, error: err.message })
    }
  }

  return results
}

async function advanceEnrollment(enrollmentId, sequenceId, currentStep) {
  const nextStep = currentStep + 1

  const { data: nextTpl } = await supabase
    .from('sequence_steps')
    .select('delay_days')
    .eq('sequence_id', sequenceId)
    .eq('step_number', nextStep)
    .maybeSingle()

  if (!nextTpl) {
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
      current_step: nextStep,
      next_send_date: nextDate.toISOString().split('T')[0],
    })
    .eq('id', enrollmentId)
}
