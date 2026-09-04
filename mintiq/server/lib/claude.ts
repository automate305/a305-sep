import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, StageId } from "../../shared/schema.js";

export const MODEL = process.env.MINTIQ_MODEL || "claude-opus-5";

let _client: Anthropic | null = null;
export function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env (local) or Vercel project settings.");
    }
    _client = new Anthropic({ maxRetries: 2, timeout: 10 * 60 * 1000 });
  }
  return _client;
}

export type Emit = (event: AgentEvent) => void;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  searches: number;
}

export interface RunStageOptions {
  stage: StageId;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  emit: Emit;
  usage: Usage;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  webSearch?: { maxUses: number; city?: string; region?: string };
  outputFormat?: Anthropic.Beta.Messages.MessageCreateParams["output_config"] extends infer T
    ? T extends { format?: infer F } ? F : never
    : never;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Runs one committee stage as a streaming Claude call.
 * - Streams thinking summaries, text, and web-search activity to the UI as events.
 * - Resumes `pause_turn` automatically (server-tool turns can pause).
 * - Returns the final text of the last assistant turn.
 */
export async function runStage(opts: RunStageOptions): Promise<string> {
  const { stage, emit, usage } = opts;
  const started = Date.now();
  emit({ type: "stage", stage, status: "start" });

  const tools: Anthropic.Beta.BetaToolUnion[] = [];
  if (opts.webSearch) {
    tools.push({
      type: "web_search_20260209",
      name: "web_search",
      max_uses: opts.webSearch.maxUses,
      user_location: {
        type: "approximate",
        country: "US",
        city: opts.webSearch.city || null,
        region: opts.webSearch.region || null,
        timezone: "America/New_York",
      },
    });
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.content }];
  let finalText = "";
  let lastQuery = "";

  for (let turn = 0; turn < 8; turn++) {
    const stream = client().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: opts.maxTokens ?? 16000,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages,
        tools: tools.length ? tools : undefined,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: {
          effort: opts.effort ?? "medium",
          ...(opts.outputFormat ? { format: opts.outputFormat as any } : {}),
        },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: opts.signal },
    );

    let thinkingBuf = "";
    stream.on("thinking", (delta) => {
      thinkingBuf += delta;
      // Flush thinking in sentence-sized chunks so the timeline reads naturally.
      if (/[.!?]\s$/.test(thinkingBuf) || thinkingBuf.length > 240) {
        emit({ type: "thinking", stage, text: thinkingBuf.trim() });
        thinkingBuf = "";
      }
    });
    stream.on("text", (delta) => emit({ type: "text", stage, text: delta }));
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use" && block.name === "web_search") {
        const q = (block.input as { query?: string })?.query;
        if (q && q !== lastQuery) {
          lastQuery = q;
          usage.searches += 1;
          emit({ type: "search", stage, query: q });
        }
      } else if (block.type === "web_search_tool_result") {
        const content = block.content;
        if (Array.isArray(content)) {
          emit({
            type: "search_result",
            stage,
            count: content.length,
            titles: content.slice(0, 4).map((r) => (r.type === "web_search_result" ? r.title : "")).filter(Boolean),
          });
        } else if (content && typeof content === "object" && "error_code" in content) {
          emit({ type: "thinking", stage, text: `Search unavailable (${content.error_code}); continuing with what I have.` });
        }
      }
    });

    const message = await stream.finalMessage();
    if (thinkingBuf.trim()) emit({ type: "thinking", stage, text: thinkingBuf.trim() });

    usage.input_tokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    usage.output_tokens += message.usage.output_tokens;

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    finalText += text;

    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") {
      const why = message.stop_details && "explanation" in (message.stop_details as object)
        ? String((message.stop_details as { explanation?: string }).explanation ?? "")
        : "";
      throw new Error(`The model declined to complete the ${stage} stage${why ? `: ${why}` : "."}`);
    }
    if (message.stop_reason === "max_tokens") {
      emit({ type: "thinking", stage, text: "Output limit reached; using the analysis gathered so far." });
    }
    break;
  }

  emit({ type: "stage", stage, status: "done", duration_ms: Date.now() - started });
  return finalText;
}
