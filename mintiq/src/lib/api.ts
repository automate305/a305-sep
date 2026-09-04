import type { AgentEvent, DealMemo, IntakeRequest } from "../../shared/schema";

export type OnEvent = (event: AgentEvent) => void;

/** POST to an SSE endpoint and forward events as they arrive. */
async function streamPost(url: string, body: unknown, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok || !resp.body) {
    let message = `Server responded ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error) message = j.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as AgentEvent);
        } catch { /* skip malformed frame */ }
      }
    }
  }
}

/** Single-request run against /api/analyze (local and self-hosted servers). */
export function analyze(intake: IntakeRequest, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPost("/api/analyze", intake, onEvent, signal);
}

type StageUsage = { input_tokens: number; output_tokens: number; searches: number };

async function stage(url: string, body: unknown, onEvent: OnEvent, signal: AbortSignal): Promise<{ text: string | null; usage: StageUsage }> {
  let out: { text: string | null; usage: StageUsage } | null = null;
  let failure: string | null = null;
  await streamPost(url, body, (e) => {
    if (e.type === "stage_output") out = { text: e.text, usage: e.usage };
    else if (e.type === "error") failure = e.message;
    else if (e.type !== "done") onEvent(e);
  }, signal);
  if (!out) throw new Error(failure ?? `${url} ended without output`);
  return out;
}

/**
 * Orchestrated run: five Tier 1 analysts in parallel, then the committee, then synthesis,
 * each as its own short server request. Works everywhere and keeps every request well
 * inside serverless time limits.
 */
export async function analyzeStaged(intake: IntakeRequest, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  const started_at = Date.now();
  onEvent({ type: "run_start", run_id: `run_${started_at.toString(36)}`, business_name: intake.business_name, model: "claude-opus-5" });
  const lean = { ...intake, files: [] };
  const [profile, reputation, records, industry, financials] = await Promise.all([
    ...(["profile", "reputation", "records", "industry"] as const).map((s) => stage("/api/stage/research", { intake: lean, stage: s }, onEvent, signal)),
    stage("/api/stage/financials", { intake }, onEvent, signal),
  ]);
  const outputs = { profile: profile.text ?? "", reputation: reputation.text ?? "", records: records.text ?? "", industry: industry.text ?? "", financials: financials.text };
  const sum = (...u: StageUsage[]) => u.reduce((a, b) => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, searches: a.searches + b.searches }), { input_tokens: 0, output_tokens: 0, searches: 0 });
  const cases = await stage("/api/stage/cases", { intake: lean, outputs }, onEvent, signal);
  const prior_usage = sum(profile.usage, reputation.usage, records.usage, industry.usage, financials.usage, cases.usage);
  await streamPost("/api/stage/synthesis", { intake: lean, outputs, cases: cases.text, prior_usage, started_at }, onEvent, signal);
}

export interface SamplePayload {
  intake: IntakeRequest;
  memo: DealMemo;
  replay: Array<{ at: number; event: AgentEvent }>;
}

export async function fetchSample(): Promise<SamplePayload> {
  const resp = await fetch("/api/sample");
  if (!resp.ok) throw new Error("Could not load the sample deal.");
  return resp.json();
}

/** Replays a recorded timeline with real delays; resolves when done or aborted. */
export function replay(frames: SamplePayload["replay"], onEvent: OnEvent, signal: AbortSignal, speed = 1): Promise<void> {
  return new Promise((resolve) => {
    const timers: number[] = [];
    const finish = () => { timers.forEach(clearTimeout); resolve(); };
    signal.addEventListener("abort", finish, { once: true });
    frames.forEach(({ at, event }) => {
      timers.push(window.setTimeout(() => {
        if (signal.aborted) return;
        onEvent(event);
        if (event.type === "done") finish();
      }, at / speed));
    });
  });
}

export async function health(): Promise<{ ok: boolean; model: string; has_key: boolean }> {
  const resp = await fetch("/api/health");
  return resp.json();
}

export interface MemoPayload { token: string; business_name: string; source: "ui" | "webhook" | "sample"; memo: DealMemo; stats: { duration_ms: number; input_tokens: number; output_tokens: number; searches: number } | null; created_at: string }

export async function fetchMemo(token: string): Promise<MemoPayload> {
  const resp = await fetch(`/api/memos/${encodeURIComponent(token)}`);
  if (!resp.ok) {
    let message = `Memo lookup failed (${resp.status}).`;
    try { const j = await resp.json(); if (j?.error) message = j.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return resp.json();
}
