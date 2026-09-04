import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DealMemoSchema, type AgentEvent, type DealMemo, type IntakeFile, type IntakeRequest } from "../../shared/schema.js";
import { runStage, type Emit, type Usage, MODEL } from "./claude.js";
import { CASES_PROMPT, FINANCIALS_PROMPT, RESEARCHER_PROMPTS, SYNTHESIS_PROMPT, describeIntake, searchBudgetNote } from "./prompts.js";

const RESEARCH_SEARCH_BUDGET = Number(process.env.MINTIQ_SEARCHES_PER_AGENT || 8);

export const RESEARCH_STAGES = ["profile", "reputation", "records", "industry"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

/** Text produced by each Tier 1 analyst; financials is null when no documents were uploaded. */
export interface StageOutputs {
  profile: string;
  reputation: string;
  records: string;
  industry: string;
  financials: string | null;
}

const ACCEPTED_DOCS: Record<string, "pdf" | "image" | "text"> = {
  "application/pdf": "pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "text/csv": "text",
  "text/plain": "text",
};

function fileToBlocks(file: IntakeFile): Anthropic.Beta.BetaContentBlockParam[] {
  const kind = ACCEPTED_DOCS[file.media_type];
  if (kind === "pdf") {
    return [
      { type: "text", text: `Document: ${file.name}` },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data }, title: file.name },
    ];
  }
  if (kind === "image") {
    return [
      { type: "text", text: `Document (image): ${file.name}` },
      { type: "image", source: { type: "base64", media_type: file.media_type as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: file.data } },
    ];
  }
  if (kind === "text") {
    const text = Buffer.from(file.data, "base64").toString("utf-8");
    return [{ type: "text", text: `Document (${file.name}):\n\n${text}` }];
  }
  return [{ type: "text", text: `Document ${file.name} has an unsupported type (${file.media_type}) and was skipped.` }];
}

function location(intake: IntakeRequest) {
  return { city: intake.city, region: intake.state === "FL" ? "Florida" : intake.state };
}

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

/** One web-research analyst. Fails soft: returns a note the committee can read. */
export async function runResearch(stage: ResearchStage, intake: IntakeRequest, emit: Emit, usage: Usage, signal?: AbortSignal): Promise<string> {
  const intakeText = describeIntake(intake);
  try {
    return await runStage({
      stage,
      system: `${RESEARCHER_PROMPTS[stage].system}\n\n${searchBudgetNote(RESEARCH_SEARCH_BUDGET)}`,
      content: [{ type: "text", text: `APPLICANT\n${intakeText}\n\nTASK\n${RESEARCHER_PROMPTS[stage].task}` }],
      emit,
      usage,
      effort: "medium",
      maxTokens: 6000,
      webSearch: { maxUses: RESEARCH_SEARCH_BUDGET, ...location(intake) },
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "stage", stage, status: "error", note: message });
    return `(${stage} analyst failed: ${message})`;
  }
}

/** Financial statement analyst over uploaded documents. Emits "skipped" when there are none. */
export async function runFinancials(intake: IntakeRequest, emit: Emit, usage: Usage, signal?: AbortSignal): Promise<string | null> {
  const files = (intake.files ?? []).filter((f) => f.data && f.name);
  if (!files.length) {
    emit({ type: "stage", stage: "financials", status: "skipped", note: "No documents uploaded" });
    return null;
  }
  try {
    return await runStage({
      stage: "financials",
      system: FINANCIALS_PROMPT.system,
      content: [
        { type: "text", text: `APPLICANT\n${describeIntake(intake)}` },
        ...files.flatMap(fileToBlocks),
        { type: "text", text: `TASK\n${FINANCIALS_PROMPT.task}` },
      ],
      emit,
      usage,
      effort: "high",
      maxTokens: 8000,
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "stage", stage: "financials", status: "error", note: message });
    return `(financial analyst failed: ${message})`;
  }
}

export function buildResearchPack(intake: IntakeRequest, outputs: StageOutputs): string {
  return [
    `## APPLICANT\n${describeIntake(intake)}`,
    `## BUSINESS PROFILE ANALYST\n${outputs.profile}`,
    `## REPUTATION ANALYST\n${outputs.reputation}`,
    `## PUBLIC RECORDS ANALYST\n${outputs.records}`,
    `## INDUSTRY ANALYST\n${outputs.industry}`,
    `## FINANCIAL STATEMENT ANALYST\n${outputs.financials ?? "No financial documents were provided. Treat cash-flow metrics as unknown and lower confidence accordingly."}`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

export async function runCases(researchPack: string, emit: Emit, usage: Usage, signal?: AbortSignal): Promise<string> {
  return runStage({
    stage: "cases",
    system: CASES_PROMPT.system,
    content: [{ type: "text", text: `${researchPack}\n\n## TASK\n${CASES_PROMPT.task}` }],
    emit,
    usage,
    effort: "medium",
    maxTokens: 6000,
    signal,
  });
}

// ---------------------------------------------------------------------------
// Tier 3
// ---------------------------------------------------------------------------

/**
 * The memo schema is too large for grammar-constrained structured output, so the editor
 * writes JSON in a fenced block; we validate with Zod and ask for one repair pass if needed.
 */
export async function runSynthesis(researchPack: string, cases: string, emit: Emit, usage: Usage, signal?: AbortSignal): Promise<DealMemo> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(DealMemoSchema), null, 1);
  const task = `${SYNTHESIS_PROMPT.task}\n\nOUTPUT FORMAT\nReturn exactly one JSON object inside a \`\`\`json fenced block and nothing else. It must validate against this JSON Schema (all keys required; use null where the schema allows it and the data is unknown). talking_points needs 2–5 items, key_takeaways 3–6, next_steps 2–6, score_breakdown 5–8, findings at least 4, briefing_script 8–18.\n${jsonSchema}`;
  const memoText = await runStage({
    stage: "synthesis",
    system: SYNTHESIS_PROMPT.system,
    content: [{ type: "text", text: `${researchPack}\n\n## CREDIT COMMITTEE CASES & PRODUCT FIT\n${cases}\n\n## TASK\n${task}` }],
    emit,
    usage,
    effort: "medium",
    maxTokens: 20000,
    signal,
  });

  let parsed = DealMemoSchema.safeParse(extractJson(memoText));
  if (!parsed.success) {
    emit({ type: "thinking", stage: "synthesis", text: "Memo JSON needs a fix; asking the editor to repair it." });
    const issues = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    const repaired = await runStage({
      stage: "synthesis",
      system: SYNTHESIS_PROMPT.system,
      content: [{ type: "text", text: `The JSON below failed validation. Fix ONLY the listed problems and return the complete corrected JSON object in a \`\`\`json fenced block.\n\nPROBLEMS\n${issues}\n\nSCHEMA\n${jsonSchema}\n\nJSON\n${memoText.slice(0, 60000)}` }],
      emit,
      usage,
      effort: "low",
      maxTokens: 20000,
      signal,
    });
    parsed = DealMemoSchema.safeParse(extractJson(repaired));
    if (!parsed.success) throw new Error(`Deal memo failed validation: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  }
  return normalizeMemo(parsed.data);
}

// ---------------------------------------------------------------------------
// Whole committee in one process (local server, self-hosted, webhook path)
// ---------------------------------------------------------------------------

export async function runCommittee(intake: IntakeRequest, emit: Emit, signal?: AbortSignal): Promise<DealMemo> {
  const runId = `run_${Date.now().toString(36)}`;
  const started = Date.now();
  const usage: Usage = { input_tokens: 0, output_tokens: 0, searches: 0 };
  emit({ type: "run_start", run_id: runId, business_name: intake.business_name, model: MODEL });

  const [research, financials] = await Promise.all([
    Promise.all(RESEARCH_STAGES.map((stage) => runResearch(stage, intake, emit, usage, signal))),
    runFinancials(intake, emit, usage, signal),
  ]);
  const [profile, reputation, records, industry] = research;
  const pack = buildResearchPack(intake, { profile, reputation, records, industry, financials });
  const cases = await runCases(pack, emit, usage, signal);
  const memo = await runSynthesis(pack, cases, emit, usage, signal);

  emit({ type: "memo", memo });
  emit({ type: "stats", duration_ms: Date.now() - started, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, searches: usage.searches });
  return memo;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the JSON object out of a fenced block (or the outermost braces) in model text. */
export function extractJson(text: string): unknown {
  const fence = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim()).filter((t) => t.startsWith("{"));
  const candidates = fence.length ? fence : [];
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  return null;
}

/** Clamp numbers the loosened schema no longer constrains and backfill empty lists. */
export function normalizeMemo(memo: DealMemo): DealMemo {
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
  const v = memo.verdict;
  const talking = v.talking_points.length ? v.talking_points : v.key_takeaways.slice(0, 3);
  return {
    ...memo,
    verdict: { ...v, fit_score: clamp(v.fit_score, 0, 100), talking_points: talking },
    score_breakdown: memo.score_breakdown.map((s) => ({ ...s, score: clamp(s.score, 0, 10) })),
    reputation: { ...memo.reputation, google_review_count: memo.reputation.google_review_count === null ? null : Math.round(memo.reputation.google_review_count) },
    financial_snapshot: memo.financial_snapshot ? { ...memo.financial_snapshot, nsf_count: memo.financial_snapshot.nsf_count === null ? null : Math.round(memo.financial_snapshot.nsf_count) } : null,
  };
}

export type { AgentEvent };
