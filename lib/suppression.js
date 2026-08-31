import { supabase } from './supabase.js'

export async function isGloballyBlocklisted(email) {
  const domain = email.split('@')[1]
  const { data } = await supabase
    .from('global_blocklist')
    .select('id, entry_type')
    .or(`entry.eq.${email},entry.eq.${domain}`)
    .limit(1)
  return (data && data.length > 0)
}

export async function isBrandSuppressed(email, brandId) {
  const { data } = await supabase
    .from('brand_suppressions')
    .select('id')
    .eq('brand_id', brandId)
    .eq('email', email)
    .limit(1)
  return (data && data.length > 0)
}

export async function isSuppressed(email, brandId) {
  if (await isGloballyBlocklisted(email)) {
    return { suppressed: true, tier: 'GLOBAL', reason: 'Global blocklist' }
  }
  if (await isBrandSuppressed(email, brandId)) {
    return { suppressed: true, tier: 'BRAND', reason: 'Brand suppression (unsubscribe or hard bounce)' }
  }
  return { suppressed: false }
}

export async function addGlobalBlock(entry, entryType = 'email', reason = null) {
  await supabase.from('global_blocklist').upsert(
    { entry, entry_type: entryType, reason },
    { onConflict: 'entry' }
  )
}

export async function addBrandSuppression(brandId, email, reason, source = null) {
  await supabase.from('brand_suppressions').upsert(
    { brand_id: brandId, email, reason, source },
    { onConflict: 'brand_id,email' }
  )
}

export async function hasActiveReply(contactId, brandId) {
  const { data } = await supabase
    .from('enrollments')
    .select('id')
    .eq('contact_id', contactId)
    .eq('brand_id', brandId)
    .eq('status', 'replied')
    .limit(1)
  return (data && data.length > 0)
}

export async function pauseContactSequences(contactId, brandId) {
  await supabase
    .from('enrollments')
    .update({ status: 'paused' })
    .eq('contact_id', contactId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
}

export async function isContactInActiveSequence(contactId, brandId, excludeCampaignId) {
  let query = supabase
    .from('enrollments')
    .select('id, campaign_id')
    .eq('contact_id', contactId)
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .limit(1)
  if (excludeCampaignId) {
    query = query.neq('campaign_id', excludeCampaignId)
  }
  const { data } = await query
  return (data && data.length > 0)
}
