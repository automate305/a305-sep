export function formatMessageId(messageId) {
  const value = String(messageId || '').trim()
  if (!value) return null
  const bare = value.replace(/^<|>$/g, '')
  if (!bare) return null
  return `<${bare}>`
}

export function threadHeaders(messageId) {
  const formatted = formatMessageId(messageId)
  if (!formatted) return {}
  return {
    'In-Reply-To': formatted,
    References: formatted
  }
}
