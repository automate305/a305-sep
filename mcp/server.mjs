#!/usr/bin/env node
// Stdio MCP for Outbox (a305-sep). Talks only to the existing HTTP API.
// OUTBOX_URL is the deployed origin. OUTBOX_SECRET is the x-a305-secret value.
// Neither value is printed.
// Replies are newline-delimited JSON-RPC. A Content-Length request switches
// replies to header framing for the rest of the process.

const PROTOCOL = '2024-11-05'
const SEND_CONFIRM = 'send-approved-queue'

const TOOLS = [
  {
    name: 'outbox_health',
    description: 'Public Outbox health. Booleans only, no secret values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'outbox_readiness',
    description: 'Check which active mailboxes can authenticate. Sends no mail.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign: { type: 'string', description: 'Optional campaign slug, such as hvac.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'outbox_overview',
    description: 'Sequences, sender caps, pipeline counts, and up to 25 held first touches.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign: { type: 'string', description: 'Optional campaign slug.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'outbox_enroll',
    description: 'Add contacts to a sequence. First touches stay held until a person approves them. This does not send mail.',
    inputSchema: {
      type: 'object',
      properties: {
        sequence: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today on the server.' },
        contacts: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' },
              first_name: { type: 'string' },
              last_name: { type: 'string' },
              company: { type: 'string' },
              title: { type: 'string' },
              phone: { type: 'string' },
              city: { type: 'string' },
              state: { type: 'string' },
              practice_name: { type: 'string' },
              source: { type: 'string' }
            },
            required: ['email'],
            additionalProperties: true
          }
        }
      },
      required: ['sequence', 'contacts'],
      additionalProperties: false
    }
  },
  {
    name: 'outbox_review_hold',
    description: 'Approve or skip one held enrollment. Approve makes it eligible for the next send run. Skip pauses it.',
    inputSchema: {
      type: 'object',
      properties: {
        enrollment_id: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'skip'] }
      },
      required: ['enrollment_id', 'decision'],
      additionalProperties: false
    }
  },
  {
    name: 'outbox_set_contact_status',
    description: 'Stop or pause a contact. replied, bounced, and unsubscribed suppress them.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        status: {
          type: 'string',
          enum: ['replied', 'bounced', 'unsubscribed', 'paused', 'held', 'active']
        },
        hold_reason: { type: 'string' }
      },
      required: ['email', 'status'],
      additionalProperties: false
    }
  },
  {
    name: 'outbox_send_approved',
    description: 'Process the already-approved queue. Held first touches are not included. Requires confirm set to send-approved-queue.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'string' }
      },
      required: ['confirm'],
      additionalProperties: false
    }
  }
]

let headerReplies = false

function send(message) {
  const json = JSON.stringify(message)
  if (!headerReplies) {
    process.stdout.write(json + '\n')
    return
  }
  const payload = Buffer.from(json, 'utf8')
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`)
  process.stdout.write(payload)
}

function toolResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    isError
  }
}

async function outbox(path, { method = 'GET', body, authed = true } = {}) {
  const base = (process.env.OUTBOX_URL || '').replace(/\/$/, '')
  if (!base) {
    return { ok: false, status: 0, body: { error: 'OUTBOX_URL is not set' } }
  }
  const headers = { Accept: 'application/json' }
  if (authed) {
    if (!process.env.OUTBOX_SECRET) {
      return { ok: false, status: 0, body: { error: 'OUTBOX_SECRET is not set' } }
    }
    headers['x-a305-secret'] = process.env.OUTBOX_SECRET
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let parsed = {}
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { error: 'Outbox returned a non-JSON response', status: response.status }
    }
  }
  return { ok: response.ok, status: response.status, body: parsed }
}

async function callTool(name, args) {
  if (name === 'outbox_health') {
    const result = await outbox('/api/health', { authed: false })
    return toolResult(JSON.stringify(result.body), !result.ok && result.status !== 200)
  }
  if (name === 'outbox_readiness') {
    const campaign = args.campaign ? `?campaign=${encodeURIComponent(args.campaign)}` : ''
    const result = await outbox(`/api/readiness${campaign}`)
    return toolResult(JSON.stringify(result.body), !result.ok)
  }
  if (name === 'outbox_overview') {
    const campaign = args.campaign ? `?campaign=${encodeURIComponent(args.campaign)}` : ''
    const result = await outbox(`/api/overview${campaign}`)
    return toolResult(JSON.stringify(result.body), !result.ok)
  }
  if (name === 'outbox_enroll') {
    if (!Array.isArray(args.contacts) || args.contacts.length === 0 || args.contacts.length > 50) {
      return toolResult(JSON.stringify({ error: 'contacts must contain 1 to 50 rows' }), true)
    }
    const result = await outbox('/api/enroll', {
      method: 'POST',
      body: {
        approval_required: true,
        contacts: args.contacts,
        sequence: args.sequence,
        start_date: args.start_date
      }
    })
    return toolResult(JSON.stringify(result.body), !result.ok)
  }
  if (name === 'outbox_review_hold') {
    const result = await outbox('/api/review', {
      method: 'POST',
      body: { decision: args.decision, enrollment_id: args.enrollment_id }
    })
    return toolResult(JSON.stringify(result.body), !result.ok)
  }
  if (name === 'outbox_set_contact_status') {
    const result = await outbox('/api/update-status', {
      method: 'POST',
      body: { email: args.email, hold_reason: args.hold_reason, status: args.status }
    })
    return toolResult(JSON.stringify(result.body), !result.ok)
  }
  if (name === 'outbox_send_approved') {
    if (args.confirm !== SEND_CONFIRM) {
      return toolResult(JSON.stringify({
        error: `Refused. Pass confirm "${SEND_CONFIRM}" to process the approved queue.`
      }), true)
    }
    const result = await outbox('/api/send', { method: 'POST', body: {} })
    return toolResult(JSON.stringify(result.body), !result.ok)
  }
  return toolResult(JSON.stringify({ error: `Unknown tool ${name}` }), true)
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'outbox', version: '1.0.0' }
      }
    })
    return
  }
  if (message.method === 'ping') {
    send({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } })
    return
  }
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {})
      send({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: toolResult(JSON.stringify({ error: error.message || 'Outbox call failed' }), true)
      })
    }
    return
  }
  send({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` }
  })
}

function leadingWhitespace(buffer) {
  let index = 0
  while (index < buffer.length) {
    const byte = buffer[index]
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0b && byte !== 0x0c) break
    index += 1
  }
  return index
}

function startsWithContentLength(buffer) {
  const prefix = 'content-length'
  if (buffer.length < prefix.length) return false
  return buffer.subarray(0, prefix.length).toString('ascii').toLowerCase() === prefix
}

function accept(raw) {
  try {
    handle(JSON.parse(raw))
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: error.message || 'Parse error' }
    })
  }
}

function start() {
  let buffer = Buffer.alloc(0)
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length > 0) {
      const skip = leadingWhitespace(buffer)
      if (skip === buffer.length) return
      const rest = buffer.subarray(skip)
      if (startsWithContentLength(rest)) {
        headerReplies = true
        const headerEnd = rest.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        const header = rest.subarray(0, headerEnd).toString('utf8')
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (!match) {
          buffer = Buffer.from(rest.subarray(headerEnd + 4))
          continue
        }
        const length = Number(match[1])
        const startAt = headerEnd + 4
        if (rest.length < startAt + length) return
        const raw = rest.subarray(startAt, startAt + length).toString('utf8')
        buffer = Buffer.from(rest.subarray(startAt + length))
        accept(raw)
        continue
      }
      const newline = rest.indexOf('\n')
      if (newline === -1) return
      const line = rest.subarray(0, newline).toString('utf8').trim()
      buffer = Buffer.from(rest.subarray(newline + 1))
      if (!line) continue
      accept(line)
    }
  })
}

start()
