import { callClaude, logAICost, MODEL } from './ai-client.js';

export function checkClaimSafety(text, bannedClaims) {
  const lower = text.toLowerCase();
  const matches = bannedClaims.filter((claim) => lower.includes(claim.toLowerCase()));
  return { safe: matches.length === 0, matches };
}

export function validateSlotValue(slotName, value, bannedClaims) {
  const lower = value.toLowerCase();
  const matches = bannedClaims.filter((claim) => lower.includes(claim.toLowerCase()));
  return { safe: matches.length === 0, matches };
}

const CLASSIFIER_SYSTEM = `You are a medical claim safety classifier for aesthetic device marketing.
Flag ANY text that asserts clinical efficacy, treatment outcomes, patient results, safety claims, or comparative medical superiority for medical aesthetic devices.
Respond with JSON only: {"safe": boolean, "flaggedPhrases": string[], "reasoning": string}`;

export async function classifyClaimsAI(text, brandSlug, supabase) {
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', brandSlug)
    .single();

  const brandId = brand?.id;

  const result = await callClaude({
    model: MODEL.HAIKU,
    system: CLASSIFIER_SYSTEM,
    messages: [{ role: 'user', content: `Classify this marketing copy:\n\n${text}` }],
    maxTokens: 512,
    temperature: 0,
  });

  if (brandId) {
    await logAICost({
      brandId,
      model: MODEL.HAIKU,
      taskType: 'claim_safety_classification',
      usage: result.usage,
      supabase,
    });
  }

  try {
    const parsed = JSON.parse(result.content);
    return {
      safe: parsed.safe,
      flaggedPhrases: parsed.flaggedPhrases || [],
      reasoning: parsed.reasoning || '',
    };
  } catch {
    return { safe: false, flaggedPhrases: [], reasoning: 'Failed to parse classifier response' };
  }
}
