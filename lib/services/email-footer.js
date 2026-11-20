// Commercial email must carry the sender's valid postal address (CAN-SPAM).
// Automate305 operates the sending for both brands, so both use its address.
// A brand with no entry gets no footer, and the send path holds the message
// rather than sending mail without an address.
const AUTOMATE305_POSTAL_ADDRESS = 'Automate305, 12864 Biscayne Blvd, PMB #2203, North Miami, FL 33181'

export const POSTAL_ADDRESS_BY_CAMPAIGN = {
  aesthetic: AUTOMATE305_POSTAL_ADDRESS,
  hvac: AUTOMATE305_POSTAL_ADDRESS
}

export function buildEmailFooter({ campaign, unsubscribeUrl }) {
  const address = POSTAL_ADDRESS_BY_CAMPAIGN[campaign]
  if (!address) return null

  const optOut = unsubscribeUrl
    ? `Don't want to hear from me? Unsubscribe here: ${unsubscribeUrl}\n` +
      `Or reply "unsubscribe" and I'll take you off the list.`
    : `Don't want to hear from me? Reply "unsubscribe" and I'll take you off the list.`

  return `\n\n---\n${optOut}\nSent by ${address}`
}
