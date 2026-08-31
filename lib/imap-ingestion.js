import Imap from 'imap'
import { simpleParser } from 'mailparser'

const BOUNCE_FROM = /mailer-daemon|postmaster/i
const BOUNCE_SUBJECT = /delivery failed|undeliverable|returned mail/i
const HARD_BOUNCE_BODY = /does not exist|user unknown|no such user|mailbox not found|invalid address/i
const SOFT_BOUNCE_BODY = /temporarily|try again|quota|rate limit/i
const OOO_SUBJECT = /out of office|automatic reply|auto-reply|away from office/i
const UNSUB_PATTERN = /unsubscribe/i

function classifyMessage(parsed) {
  const from = parsed.from?.text || ''
  const subject = parsed.subject || ''
  const body = parsed.text || ''
  const headers = parsed.headers

  if (UNSUB_PATTERN.test(subject) || UNSUB_PATTERN.test(body)) {
    return 'UNSUBSCRIBE'
  }

  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject)) {
    if (HARD_BOUNCE_BODY.test(body)) return 'BOUNCE_HARD'
    if (SOFT_BOUNCE_BODY.test(body)) return 'BOUNCE_SOFT'
    return 'BOUNCE_SOFT'
  }

  if (OOO_SUBJECT.test(subject) || headers.has('x-auto-response-suppress')) {
    return 'OOO'
  }

  const autoSubmitted = headers.get('auto-submitted')
  if (autoSubmitted && autoSubmitted !== 'no') return 'AUTO_REPLY'

  const precedence = headers.get('precedence')
  if (precedence && /bulk|junk|auto_reply/i.test(precedence)) return 'AUTO_REPLY'

  return 'REPLY'
}

function openImap(imapConfig) {
  return new Promise((resolve, reject) => {
    const conn = new Imap({
      user: imapConfig.user,
      password: imapConfig.pass,
      host: imapConfig.host,
      port: imapConfig.port,
      tls: imapConfig.tls !== false,
      tlsOptions: { rejectUnauthorized: true }
    })
    conn.once('ready', () => resolve(conn))
    conn.once('error', reject)
    conn.connect()
  })
}

function openInbox(conn) {
  return new Promise((resolve, reject) => {
    conn.openBox('INBOX', false, (err, box) => {
      if (err) reject(err)
      else resolve(box)
    })
  })
}

function searchUnseen(conn) {
  return new Promise((resolve, reject) => {
    conn.search(['UNSEEN'], (err, uids) => {
      if (err) reject(err)
      else resolve(uids || [])
    })
  })
}

function fetchMessages(conn, uids) {
  return new Promise((resolve, reject) => {
    const messages = []
    const f = conn.fetch(uids, { bodies: '', markSeen: true })
    f.on('message', (msg) => {
      let buffer = ''
      msg.on('body', (stream) => {
        stream.on('data', (chunk) => { buffer += chunk.toString('utf8') })
      })
      msg.once('end', () => { messages.push(buffer) })
    })
    f.once('error', reject)
    f.once('end', () => resolve(messages))
  })
}

async function threadMatch(parsed, supabase) {
  const inReplyTo = parsed.inReplyTo
  const references = parsed.references || []
  const messageIds = [inReplyTo, ...references].filter(Boolean)

  if (messageIds.length === 0) return null

  const { data } = await supabase
    .from('send_log')
    .select('id, enrollment_id, contact_id, sender_id, step')
    .in('message_id', messageIds)
    .limit(1)

  return data?.[0] || null
}

async function pauseContactSequences(contactId, brandId, supabase) {
  await supabase
    .from('enrollments')
    .update({ status: 'paused', paused_at: new Date().toISOString(), pause_reason: 'reply_received' })
    .eq('contact_id', contactId)
    .eq('brand_id', brandId)
    .in('status', ['active', 'scheduled'])
}

async function addSuppression(contactId, brandId, reason, supabase) {
  await supabase
    .from('brand_suppressions')
    .upsert({
      contact_id: contactId,
      brand_id: brandId,
      reason,
      suppressed_at: new Date().toISOString()
    }, { onConflict: 'contact_id,brand_id' })
}

async function storeInbound(parsed, classification, matchedLog, brandId, mailboxAddress, supabase) {
  const record = {
    brand_id: brandId,
    mailbox: mailboxAddress,
    from_address: parsed.from?.text || '',
    to_address: parsed.to?.text || '',
    subject: parsed.subject || '',
    body_text: (parsed.text || '').slice(0, 10000),
    message_id: parsed.messageId || null,
    in_reply_to: parsed.inReplyTo || null,
    references: parsed.references || [],
    classification,
    send_log_id: matchedLog?.id || null,
    contact_id: matchedLog?.contact_id || null,
    received_at: parsed.date?.toISOString() || new Date().toISOString()
  }

  const { error } = await supabase.from('inbound_messages').insert(record)
  if (error) console.error('Failed to store inbound message:', error.message)
  return record
}

async function processClassification(classification, matchedLog, brandId, supabase) {
  if (!matchedLog) return

  switch (classification) {
    case 'REPLY':
      await pauseContactSequences(matchedLog.contact_id, brandId, supabase)
      break

    case 'BOUNCE_HARD':
      await addSuppression(matchedLog.contact_id, brandId, 'bounce_hard', supabase)
      await supabase
        .from('send_log')
        .update({ status: 'bounced_hard' })
        .eq('id', matchedLog.id)
      break

    case 'UNSUBSCRIBE':
      await addSuppression(matchedLog.contact_id, brandId, 'unsubscribe', supabase)
      break
  }
}

export async function ingestMailbox(mailboxAddress, imapConfig, brandId, supabase) {
  const results = { processed: 0, replies: 0, bounces: 0, unsubscribes: 0, auto: 0, errors: 0 }

  let conn
  try {
    conn = await openImap(imapConfig)
    await openInbox(conn)
    const uids = await searchUnseen(conn)

    if (uids.length === 0) {
      conn.end()
      return results
    }

    const rawMessages = await fetchMessages(conn, uids)

    for (const raw of rawMessages) {
      try {
        const parsed = await simpleParser(raw)
        const matchedLog = await threadMatch(parsed, supabase)
        const classification = classifyMessage(parsed)

        await storeInbound(parsed, classification, matchedLog, brandId, mailboxAddress, supabase)
        await processClassification(classification, matchedLog, brandId, supabase)

        results.processed++
        if (classification === 'REPLY') results.replies++
        else if (classification.startsWith('BOUNCE')) results.bounces++
        else if (classification === 'UNSUBSCRIBE') results.unsubscribes++
        else results.auto++
      } catch (msgErr) {
        console.error('Error processing message:', msgErr.message)
        results.errors++
      }
    }

    conn.end()
  } catch (err) {
    if (conn) try { conn.end() } catch (_) {}
    throw err
  }

  return results
}
