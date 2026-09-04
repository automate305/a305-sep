import type { AgentEvent, DealMemo, IntakeRequest } from "../../shared/schema";

export type OnEvent = (event: AgentEvent) => void;

/** POST the intake and stream committee events back as they happen. */
export async function analyze(intake: IntakeRequest, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  const resp = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intake),
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
