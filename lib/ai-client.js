export const MODEL = {
  OPUS: 'claude-opus-5',
  HAIKU: 'claude-haiku-4-5-20251001',
};

const PRICING = {
  [MODEL.OPUS]: { input: 15, output: 75, cacheRead: 1.5 },
  [MODEL.HAIKU]: { input: 0.8, output: 4, cacheRead: 0.08 },
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function callClaude({ model, system, messages, maxTokens, temperature, cacheControl }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const body = {
    model,
    max_tokens: maxTokens || 1024,
    messages,
  };

  if (temperature !== undefined) body.temperature = temperature;

  if (system) {
    if (cacheControl) {
      body.system = Array.isArray(system)
        ? system.map((s, i) => ({
            type: 'text',
            text: typeof s === 'string' ? s : s.text,
            ...(i === system.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
          }))
        : [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    } else {
      body.system = system;
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.content.map((c) => c.text).join('');
      return {
        content,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          cacheReadTokens: data.usage.cache_read_input_tokens || 0,
          cacheWriteTokens: data.usage.cache_creation_input_tokens || 0,
        },
      };
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      const errBody = await res.text();
      throw new Error(`Claude API ${res.status}: ${errBody}`);
    }

    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, delay));
  }
}

export async function logAICost({ brandId, model, taskType, usage, supabase }) {
  const pricing = PRICING[model];
  if (!pricing) throw new Error(`Unknown model for pricing: ${model}`);

  const estimatedCost =
    (usage.inputTokens * pricing.input) / 1_000_000 +
    (usage.outputTokens * pricing.output) / 1_000_000 +
    (usage.cacheReadTokens * pricing.cacheRead) / 1_000_000;

  const { error } = await supabase.from('ai_cost_log').insert({
    brand_id: brandId,
    model,
    task_type: taskType,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_read_tokens: usage.cacheReadTokens,
    cache_write_tokens: usage.cacheWriteTokens,
    estimated_cost_usd: estimatedCost,
  });

  if (error) throw new Error(`Failed to log AI cost: ${error.message}`);
  return { estimatedCost };
}

export async function checkBudget(supabase) {
  const { data: settings, error: settingsErr } = await supabase
    .from('global_settings')
    .select('monthly_ai_budget_usd')
    .single();

  if (settingsErr) throw new Error(`Failed to read global_settings: ${settingsErr.message}`);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: costRows, error: costErr } = await supabase
    .from('ai_cost_log')
    .select('estimated_cost_usd')
    .gte('created_at', monthStart);

  if (costErr) throw new Error(`Failed to read ai_cost_log: ${costErr.message}`);

  const spent = costRows.reduce((sum, r) => sum + (r.estimated_cost_usd || 0), 0);
  const budget = settings.monthly_ai_budget_usd;

  return {
    withinBudget: spent < budget,
    spent,
    budget,
    remaining: budget - spent,
  };
}
