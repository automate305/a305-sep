const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

const SPAM_PHRASES = [
  'act now', 'click here', 'limited time', 'free money', 'no obligation',
  'risk free', 'guaranteed', 'winner', 'congratulations', 'urgent',
  'buy now', 'order now', 'call now', 'apply now', 'sign up free',
  'double your', 'earn extra cash', 'work from home', 'be your own boss',
  'multi-level', 'mlm', 'casino', 'viagra', 'weight loss',
  'no credit check', 'bankruptcy', 'collect now', 'invoice attached',
]

export function mergeTemplate(text, contact, mailbox) {
  const area = contact.area || contact.city || 'South Florida'
  return (text || '')
    .replace(/\{\{first_name\}\}/g, contact.first_name || 'there')
    .replace(/\{\{last_name\}\}/g, contact.last_name || '')
    .replace(/\{\{practice_name\}\}/g, contact.practice_name || 'your practice')
    .replace(/\{\{company\}\}/g, contact.company || contact.practice_name || 'your company')
    .replace(/\{\{sender_name\}\}/g, mailbox.display_name)
    .replace(/\{\{signature\}\}/g, mailbox.signature || mailbox.display_name)
    .replace(/\{\{personalized_line\}\}/g, contact.personalized_line ||
      'I came across your company while looking at businesses in the area.')
    .replace(/\{\{personalized_paragraph\}\}/g, contact.personalized_paragraph ||
      contact.personalized_line ||
      'I came across your company while looking at businesses in the area.')
    .replace(/\{\{pain_point\}\}/g, contact.pain_point || 'scheduling and dispatch')
    .replace(/\{\{area\}\}/g, area)
    .replace(/\{\{website_observation\}\}/g, contact.website_observation ||
      'There are a few quick wins that could help it convert more visitors into booked calls.')
}

export function hasUnresolvedPlaceholders(text) {
  const matches = text.match(PLACEHOLDER_RE)
  if (!matches) return { clean: true, placeholders: [] }
  return { clean: false, placeholders: [...new Set(matches)] }
}

export function checkSpamPhrases(text) {
  const lower = text.toLowerCase()
  const found = SPAM_PHRASES.filter(phrase => lower.includes(phrase))
  return { clean: found.length === 0, phrases: found }
}

export function mergeSlotValues(text, slotValues) {
  if (!slotValues || typeof slotValues !== 'object') return text
  let result = text
  for (const [key, value] of Object.entries(slotValues)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '')
  }
  return result
}

export function buildUnsubscribeFooter(replyTo) {
  return `\n\n---\nDon't want to hear from me? Reply "unsubscribe" and I'll take you off the list.`
}

export function buildListUnsubscribeHeaders(replyTo) {
  const mailto = `mailto:${replyTo}?subject=unsubscribe`
  return {
    'List-Unsubscribe': `<${mailto}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
