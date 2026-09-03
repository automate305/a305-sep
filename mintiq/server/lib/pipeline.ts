import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DealMemoSchema, type AgentEvent, type DealMemo, type IntakeFile, type IntakeRequest } from "../../shared/schema.ts";
import { runStage, type Emit, type Usage, MODEL } from "./claude.ts";
import { CASES_PROMPT, FINANCIALS_PROMPT, RESEARCHER_PROMPTS, SYNTHESIS_PROMPT, describeIntake } from "./prompts.ts";

const RESEARCH_SEARCH_BUDGET = Number(process.env.MINTIQ_SEARCHES_PER_AGENT || 6);

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

/**
 * The MintIQ research committee.
 *
 * Tier 1 (parallel): profile, reputation, records, industry (web search) + financials (documents).
 * Tier 2: adversarial upside / downside / base cases and product fit.
 * Tier 3: structured Deal Memo.
 */
export async function runCommittee(intake: IntakeRequest, emit: Emit, signal?: AbortSignal): Promise<DealMemo> {
  const runId = `run_${Date.now().toString(36)}`;
  const started = Date.now();
  const usage: Usage = { input_tokens: 0, output_tokens: 0, searches: 0 };
  emit({ type: "run_start", run_id: runId, business_name: intake.business_name, model: MODEL });

  const intakeText = describeIntake(intake);
  const location = { city: intake.city, region: intake.state === "FL" ? "Florida" : intake.state };

  // ---- Tier 1 -------------------------------------------------------------
  const researchers = (["profile", "reputation", "records", "industry"] as const).map((stage) =>
    runStage({
      stage,
      system: RESEARCHER_PROMPTS[stage].system,
      content: [{ type: "text", text: `APPLICANT\n${intakeText}\n\nTASK\n${RESEARCHER_PROMPTS[stage].task}` }],
      emit,
      usage,
      effort: "medium",
      webSearch: { maxUses: RESEARCH_SEARCH_BUDGET, ...location },
      signal,
    }).catch((err: Error) => {
      emit({ type: "stage", stage, status: "error", note: err.message });
      return `(${stage} analyst failed: ${err.message})`;
    }),
  );

  const files = (intake.files ?? []).filter((f) => f.data && f.name);
  const financials: Promise<string | null> = files.length
    ? runStage({
        stage: "financials",
        system: FINANCIALS_PROMPT.system,
        content: [
          { type: "text", text: `APPLICANT\n${intakeText}` },
          ...files.flatMap(fileToBlocks),
          { type: "text", text: `TASK\n${FINANCIALS_PROMPT.task}` },
        ],
        emit,
        usage,
        effort: "high",
        signal,
      }).catch((err: Error) => {
        emit({ type: "stage", stage: "financials", status: "error", note: err.message });
        return `(financial analyst failed: ${err.message})`;
      })
    : Promise.resolve(null).then((v) => {
        emit({ type: "stage", stage: "financials", status: "skipped", note: "No documents uploaded" });
        return v;
      });

  const [profile, reputation, records, industry, fin] = await Promise.all([...researchers, financials]);

  const researchPack = [
    `## APPLICANT\n${intakeText}`,
    `## BUSINESS PROFILE ANALYST\n${profile}`,
    `## REPUTATION ANALYST\n${reputation}`,
    `## PUBLIC RECORDS ANALYST\n${records}`,
    `## INDUSTRY ANALYST\n${industry}`,
    `## FINANCIAL STATEMENT ANALYST\n${fin ?? "No financial documents were provided. Treat cash-flow metrics as unknown and lower confidence accordingly."}`,
  ].join("\n\n");

  // ---- Tier 2 -------------------------------------------------------------
  const cases = await runStage({
    stage: "cases",
    system: CASES_PROMPT.system,
    content: [{ type: "text", text: `${researchPack}\n\n## TASK\n${CASES_PROMPT.task}` }],
    emit,
    usage,
    effort: "high",
    signal,
  });

  // ---- Tier 3 -------------------------------------------------------------
  const memoText = await runStage({
    stage: "synthesis",
    system: SYNTHESIS_PROMPT.system,
    content: [{ type: "text", text: `${researchPack}\n\n## CREDIT COMMITTEE CASES & PRODUCT FIT\n${cases}\n\n## TASK\n${SYNTHESIS_PROMPT.task}` }],
    emit,
    usage,
    effort: "high",
    outputFormat: zodOutputFormat(DealMemoSchema),
    maxTokens: 24000,
    signal,
  });

  const memo = DealMemoSchema.parse(JSON.parse(memoText));
  emit({ type: "memo", memo });
  emit({ type: "stats", duration_ms: Date.now() - started, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, searches: usage.searches });
  return memo;
}

export type { AgentEvent };
