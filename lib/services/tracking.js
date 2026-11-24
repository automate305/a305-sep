// Optional open and click tracking through the a305-tracker service.
//
// Off unless TRACKER_API_KEY is set AND the sender's domain is listed in
// TRACKER_DOMAINS. The tracking host is always track.<sender domain>, so the
// links in a message match the domain it is sent from.
//
// Tracking must never block or break a send: every failure path (timeout, bad
// key, malformed reply, tracker down) hands the message back untouched and the
// caller sends it untracked. The unsubscribe link and the footer are never
// rewritten; only links the template itself put in the body are.

import { isUsableEnvironmentValue } from './smtp.js'

export const TRACKER_TIMEOUT_MS = 3000
const MAX_TRACKED_LINKS = 20

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', "'", '"'])

export function getTrackingConfig(senderEmail, environment = process.env) {
  const apiKey = environment.TRACKER_API_KEY
  if (!isUsableEnvironmentValue(apiKey)) return null

  const domain = String(senderEmail || '').split('@')[1]?.trim().toLowerCase()
  if (!domain) return null

  const enabledDomains = String(environment.TRACKER_DOMAINS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (!enabledDomains.includes(domain)) return null

  return {
    apiKey: String(apiKey).trim(),
    origin: `https://track.${domain}`,
    pixel: environment.TRACKER_OPEN_PIXEL === 'true'
  }
}

// Linear scan from the end. A `[...]+$` regex backtracks quadratically on a
// long run of punctuation, and this input is merged contact data.
function trimUrl(raw) {
  let end = raw.length
  while (end > 0 && TRAILING_PUNCTUATION.has(raw[end - 1])) end -= 1
  return raw.slice(0, end)
}

export function findLinks(text, { ignoreOrigin } = {}) {
  const urls = new Set()
  for (const match of String(text || '').matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0])
    if (ignoreOrigin && url.startsWith(ignoreOrigin)) continue
    urls.add(url)
  }
  return [...urls]
}

export function rewriteLinks(text, trackedByUrl) {
  return String(text || '').replace(URL_PATTERN, (raw) => {
    const url = trimUrl(raw)
    const tracked = trackedByUrl.get(url)
    return tracked ? tracked + raw.slice(url.length) : raw
  })
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function textToHtml(text) {
  let html = ''
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0])
    html += escapeHtml(text.slice(cursor, match.index))
    html += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`
    cursor = match.index + url.length
  }
  html += escapeHtml(text.slice(cursor))
  return html.replace(/\r?\n/g, '<br>\n')
}

export function buildHtmlEmail(text, pixelUrl) {
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">' +
    textToHtml(text) +
    '</div>' +
    `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:none">`
  )
}

// Returns { body, html, tracked }. `body` is the (possibly link-rewritten)
// message body without the footer; `html` is a full HTML alternative that
// carries the open pixel, or null when no pixel is wanted.
export async function prepareTracking(
  { config, messageId, recipient, campaign, body, footer },
  { fetchImpl = fetch, timeoutMs = TRACKER_TIMEOUT_MS, log = console } = {}
) {
  const untouched = { body, html: null, tracked: false }
  if (!config) return untouched

  try {
    const links = findLinks(body, { ignoreOrigin: config.origin })
    if (links.length > MAX_TRACKED_LINKS) return untouched

    let trackedBody = body
    if (links.length > 0) {
      const response = await fetchImpl(`${config.origin}/api/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
        body: JSON.stringify({ urls: links, message_id: messageId, recipient, campaign }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) {
        log.warn(`Tracking skipped: tracker answered ${response.status}`)
        return untouched
      }

      const payload = await response.json()
      const trackedByUrl = new Map()
      for (const link of payload?.links || []) {
        // Only ever swap in a link on our own tracking host.
        if (typeof link?.tracked_url === 'string' && link.tracked_url.startsWith(`${config.origin}/c/`)) {
          trackedByUrl.set(link.url, link.tracked_url)
        }
      }
      if (trackedByUrl.size !== links.length) {
        log.warn('Tracking skipped: tracker reply did not cover every link')
        return untouched
      }
      trackedBody = rewriteLinks(body, trackedByUrl)
    }

    const pixelUrl = config.pixel
      ? `${config.origin}/o/${encodeURIComponent(messageId)}.gif`
      : null
    if (trackedBody === body && !pixelUrl) return untouched

    return {
      body: trackedBody,
      html: pixelUrl ? buildHtmlEmail(trackedBody + footer, pixelUrl) : null,
      tracked: true
    }
  } catch (error) {
    log.warn(`Tracking skipped: ${error?.name || 'error'}`)
    return untouched
  }
}
