import { supabase } from './supabase.js'
import { callClaude, logAICost, checkBudget, MODEL } from './ai-client.js'
import { checkClaimSafety } from './claim-safety.js'

export async function generateSequence({ brandId, campaignId, icpSegment, offer, stepCount, voiceProfile, contentSources }) {
  const budget = await checkBudget(supabase)
  if (!budget.withinBudget) {
    return { error: 'Monthly AI budget exceeded', spent: budget.spent, budget: budget.budget }
  }

  const { data: brand } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single()

  if (!voiceProfile) {
    const { data: vp } = await supabase
      .from('voice_profiles')
      .select('*')
      .eq('brand_id', brandId)
      .single()
    voiceProfile = vp
  }

  if (!contentSources) {
    const { data: sources } = await supabase
      .from('content_sources')
      .select('title, type, body')
      .eq('brand_id', brandId)
      .limit(10)
    contentSources = sources || []
  }

  const systemPrompt = buildSystemPrompt(brand, voiceProfile, contentSources)

  const userPrompt = `Generate a ${stepCount}-step email sequence for the following:

Brand: ${brand.display_name}
ICP Segment: ${icpSegment}
Offer: ${offer}

Requirements:
- Each step needs a subject_template and body_template
- Use named personalization slots: {{first_name}}, {{last_name}}, {{practice_name}}, {{company}}, {{sender_name}}, {{signature}}
- For custom per-contact personalization, use slots like {{icebreaker}}, {{pen_evidence_line}}, {{practice_hook}}
- Include delay_days between steps (days after previous step)
- Generate TEMPLATES with slots, not per-contact emails
- Follow the voice profile exactly
- Ground claims in the provided source material only
- For each claim or specific detail, cite which content source it came from

CRITICAL: You are writing about medical aesthetic devices. NEVER assert clinical efficacy, treatment outcomes, patient results, safety claims, or comparative medical superiority. You MAY describe device specifications, trade-in offers, logistics, pricing, and availability. You may NOT describe what the device does to skin or to a patient.

Return JSON:
{
  "sequence_name": "descriptive_name",
  "steps": [
    {
      "step_number": 1,
      "delay_days": 0,
      "subject_template": "...",
      "body_template": "...",
      "personalization_slots": ["slot1", "slot2"],
      "source_citations": ["Source Title: specific claim backed"]
    }
  ]
}`

  const response = await callClaude({
    model: MODEL.OPUS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
    temperature: 0.7,
  })

  await logAICost({
    brandId,
    model: MODEL.OPUS,
    taskType: 'sequence_generation',
    usage: response.usage,
    supabase,
  })

  let parsed
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return { error: 'Failed to parse generation response', raw: response.content }
  }

  const claimIssues = []
  const { data: vp } = await supabase
    .from('voice_profiles')
    .select('banned_claims')
    .eq('brand_id', brandId)
    .single()

  const bannedClaims = vp?.banned_claims || []

  for (const step of parsed.steps) {
    const fullText = `${step.subject_template} ${step.body_template}`
    const check = checkClaimSafety(fullText, bannedClaims)
    if (!check.safe) {
      claimIssues.push({
        step: step.step_number,
        matches: check.matches,
      })
    }
  }

  if (claimIssues.length > 0) {
    return {
      error: 'Generated content contains banned claims',
      claimIssues,
      draft: parsed,
    }
  }

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .single()

  const { data: maxVersion } = await supabase
    .from('sequences')
    .select('version')
    .eq('campaign_id', campaignId)
    .order('version', { ascending: false })
    .limit(1)

  const nextVersion = (maxVersion && maxVersion.length > 0) ? maxVersion[0].version + 1 : 1

  const { data: seq, error: seqErr } = await supabase
    .from('sequences')
    .insert({
      brand_id: brandId,
      campaign_id: campaignId,
      name: `${parsed.sequence_name}_v${nextVersion}`,
      version: nextVersion,
      status: 'DRAFT',
      description: `Generated: ${icpSegment} / ${offer}`,
    })
    .select()
    .single()

  if (seqErr) return { error: seqErr.message }

  const steps = parsed.steps.map(s => ({
    sequence_id: seq.id,
    step_number: s.step_number,
    delay_days: s.delay_days,
    subject_template: s.subject_template,
    body_template: s.body_template,
  }))

  await supabase.from('sequence_steps').insert(steps)

  return {
    sequence: seq,
    steps: parsed.steps,
    claimIssues: [],
  }
}

function buildSystemPrompt(brand, voiceProfile, contentSources) {
  let prompt = `You are a cold email copywriter for ${brand.display_name}.

Voice Profile:
- Persona: ${voiceProfile.sender_persona}
- Tone: ${voiceProfile.tone_rules}
- Banned phrases: ${JSON.stringify(voiceProfile.banned_phrases)}
`

  if (voiceProfile.reference_examples && voiceProfile.reference_examples.length > 0) {
    prompt += `\nReference examples of the correct voice:\n`
    for (const ex of voiceProfile.reference_examples) {
      prompt += `---\n${ex}\n---\n`
    }
  }

  if (contentSources.length > 0) {
    prompt += `\nGround your claims in these source materials ONLY. Cite which source backs each claim.\n`
    for (const src of contentSources) {
      prompt += `\n[Source: ${src.title} (${src.type})]\n${src.body}\n`
    }
  }

  return prompt
}

export async function fillSlots({ contactId, brandId, sequenceId, stepNumber }) {
  const budget = await checkBudget(supabase)
  if (!budget.withinBudget) {
    return { error: 'Monthly AI budget exceeded' }
  }

  const [contactRes, stepRes, vpRes, sourcesRes] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', contactId).single(),
    supabase.from('sequence_steps').select('*').eq('sequence_id', sequenceId).eq('step_number', stepNumber).single(),
    supabase.from('voice_profiles').select('*').eq('brand_id', brandId).single(),
    supabase.from('content_sources').select('title, type, body').eq('brand_id', brandId).limit(5),
  ])

  const contact = contactRes.data
  const step = stepRes.data
  const vp = vpRes.data
  const sources = sourcesRes.data || []

  if (!contact || !step) return { error: 'Contact or step not found' }

  const slots = [...(step.body_template.match(/\{\{(\w+)\}\}/g) || [])]
    .map(s => s.replace(/[{}]/g, ''))
    .filter(s => !['first_name', 'last_name', 'practice_name', 'company',
      'sender_name', 'signature', 'personalized_line', 'personalized_paragraph',
      'pain_point', 'area', 'website_observation'].includes(s))

  if (slots.length === 0) return { slotValues: {} }

  const response = await callClaude({
    model: MODEL.HAIKU,
    system: `You fill personalization slots for cold emails. Brand: ${vp?.sender_persona || 'Sales rep'}.
Tone: ${vp?.tone_rules || 'Professional'}.
NEVER make clinical efficacy claims, treatment outcome claims, or safety claims about medical devices.
Return JSON only: {"slot_name": "value", ...}`,
    messages: [{
      role: 'user',
      content: `Fill these slots for this contact:
Slots: ${JSON.stringify(slots)}
Contact: ${JSON.stringify({
  name: contact.first_name,
  company: contact.company || contact.practice_name,
  title: contact.title,
  city: contact.city,
  linkedin: contact.linkedin_url,
})}
Source material: ${sources.map(s => s.body).join('\n').slice(0, 2000)}`
    }],
    maxTokens: 512,
    temperature: 0.5,
  })

  await logAICost({
    brandId,
    model: MODEL.HAIKU,
    taskType: 'slot_filling',
    usage: response.usage,
    supabase,
  })

  let slotValues
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/)
    slotValues = JSON.parse(jsonMatch[0])
  } catch {
    return { error: 'Failed to parse slot values', raw: response.content }
  }

  const bannedClaims = vp?.banned_claims || []
  for (const [key, value] of Object.entries(slotValues)) {
    const check = checkClaimSafety(value, bannedClaims)
    if (!check.safe) {
      return { error: `Slot "${key}" contains banned claims`, matches: check.matches, slotValues }
    }
  }

  return { slotValues }
}
