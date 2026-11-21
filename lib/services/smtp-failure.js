// A recipient refusal is permanent. An authentication or rate-limit
// failure is about our mailbox, and suppressing the prospect for that
// would take a live conversation off the list because Gmail rejected
// our login.

const SENDER_FAULT_CODES = new Set([421, 432, 450, 451, 452, 454, 455, 471, 530, 534, 535, 538])

export function isPermanentRecipientFailure(error) {
  const code = Number(error?.responseCode)

  if (!Number.isInteger(code) || code < 500 || code > 599) return false
  if (SENDER_FAULT_CODES.has(code)) return false

  const text = `${error?.response || ''} ${error?.message || ''}`.toLowerCase()

  return !/auth|login|password|credential|relay access|rate/.test(text)
}
