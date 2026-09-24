// ============================================================
// Automate305 SEP · /api/unsubscribe
//
// The only route here that the public reaches without a secret. It is
// reached two ways:
//
//   GET  — a person clicked the link in a footer. Renders a confirm
//          page and CHANGES NOTHING. Mail scanners, link checkers and
//          Gmail's own prefetch all issue GETs; opting someone out on a
//          GET means a security appliance can unsubscribe your whole
//          list on delivery.
//   POST — either the confirm button, or Gmail/Outlook's native
//          unsubscribe firing RFC 8058 one-click. This is the only verb
//          that suppresses.
//
// Both verbs answer identically whether or not the address is known, so
// the route cannot be used to test which addresses exist.
// ============================================================

import { createClient } from '@supabase/supabase-js'

import { isUsableEnvironmentValue } from '../../lib/services/smtp.js'
import {
  SUPPRESSION_SOURCES,
  readUnsubscribeToken,
  suppressContact
} from '../../lib/services/suppression.js'

const BRAND_STYLE = `
  :root { color-scheme: dark; }
  body {
    background: #120d1f;
    color: #efeaff;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; padding: 24px;
  }
  main {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(167,139,250,0.25);
    border-radius: 18px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.45);
    max-width: 30rem; padding: 40px 36px; width: 100%;
    backdrop-filter: blur(14px);
  }
  h1 { font-size: 1.35rem; letter-spacing: -0.01em; margin: 0 0 12px; }
  p { color: #c9c1e8; margin: 0 0 20px; }
  strong { color: #efeaff; }
  button {
    background: linear-gradient(135deg, #7c3aed, #a78bfa);
    border: 0; border-radius: 10px; color: #fff; cursor: pointer;
    font: inherit; font-weight: 600; padding: 12px 22px;
  }
  button:hover { filter: brightness(1.08); }
  .muted { color: #8b83a8; font-size: 0.85rem; margin: 22px 0 0; }
`

function renderPage({ body, title }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${BRAND_STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`
}

function sendHtml(res, statusCode, html) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.status(statusCode).send(html)
}

function confirmPage(token) {
  return renderPage({
    body: `
      <h1>Unsubscribe</h1>
      <p>Confirm and we will stop emailing this address. It takes effect
         immediately and covers every campaign we run.</p>
      <form method="POST" action="/api/unsubscribe">
        <input type="hidden" name="token" value="${token.replace(/"/g, '&quot;')}">
        <button type="submit">Unsubscribe me</button>
      </form>
      <p class="muted">Nothing has changed yet. You are still subscribed
         until you press the button.</p>`,
    title: 'Unsubscribe'
  })
}

function donePage() {
  return renderPage({
    body: `
      <h1>You are unsubscribed</h1>
      <p>We have removed this address and stopped every sequence it was in.
         You will not receive further email from us.</p>
      <p class="muted">Removed by <strong>Automate305</strong>. If this was a
         mistake, reply to any earlier message and we will put it right.</p>`,
    title: 'Unsubscribed'
  })
}

function invalidPage() {
  return renderPage({
    body: `
      <h1>This link is not valid</h1>
      <p>It may have been altered in transit or truncated by an email client.
         Reply to any message from us with the word "unsubscribe" and a person
         will take care of it.</p>`,
    title: 'Unsubscribe link not valid'
  })
}

function readToken(req) {
  const fromQuery = typeof req.query?.token === 'string' ? req.query.token : ''
  if (fromQuery) return fromQuery

  const body = req.body
  if (typeof body === 'string') return new URLSearchParams(body).get('token') || ''
  if (body && typeof body === 'object' && typeof body.token === 'string') return body.token

  return ''
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = readToken(req)
  const { email, valid } = readUnsubscribeToken(token)

  if (!valid) {
    return sendHtml(res, 400, invalidPage())
  }

  // ── GET: show, never act ──
  // A GET here is a person opening a link, a scanner following it, or a
  // client prefetching it. None of those are consent.
  if (req.method === 'GET') {
    return sendHtml(res, 200, confirmPage(token))
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    console.error('Unsubscribe could not run: Supabase is not configured')
    return sendHtml(res, 503, renderPage({
      body: `<h1>We could not complete that</h1>
             <p>Something is wrong on our side. Reply to any message from us
                with "unsubscribe" and a person will remove you.</p>`,
      title: 'Unsubscribe failed'
    }))
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  try {
    // Global scope: opting out of one brand's mail is not agreement to
    // hear from the other one.
    await suppressContact(supabase, {
      email,
      reason: 'Recipient used the unsubscribe link',
      scope: 'global',
      source: SUPPRESSION_SOURCES.ONE_CLICK
    })
  } catch (suppressionError) {
    console.error('Unsubscribe failed:', suppressionError.message)
    return sendHtml(res, 503, renderPage({
      body: `<h1>We could not complete that</h1>
             <p>Something is wrong on our side. Reply to any message from us
                with "unsubscribe" and a person will remove you.</p>`,
      title: 'Unsubscribe failed'
    }))
  }

  // RFC 8058 one-click posts machine-to-machine and reads the status
  // code, not the body; a person gets the page.
  const wantsHtml = String(req.headers.accept || '').includes('text/html')

  return wantsHtml
    ? sendHtml(res, 200, donePage())
    : res.status(200).json({ status: 'unsubscribed' })
}
