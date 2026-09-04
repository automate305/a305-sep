import express, { type Request, type Response } from "express";
import { runCommittee, runResearch, runFinancials, runCases, runSynthesis, buildResearchPack, RESEARCH_STAGES, type ResearchStage, type StageOutputs } from "./lib/pipeline.js";
import type { Usage } from "./lib/claude.js";
import { MODEL } from "./lib/claude.js";
import { SAMPLE_MEMO, SAMPLE_INTAKE, SAMPLE_REPLAY } from "../shared/sample.js";
import type { AgentEvent, DealMemo, IntakeRequest } from "../shared/schema.js";
import { getMemoByToken, memoUrl, newToken, saveMemo, markDelivered, storeMode, type RunStats } from "./lib/store.js";
import { defaultNotifyTo, isMailConfigured, sendMemoEmail } from "./lib/mailer.js";
import { normalizeSubmission } from "./lib/webhook.js";

/** Vercel caps request bodies at ~4.5 MB; keep uploads comfortably under it. */
export const MAX_BODY = process.env.MINTIQ_MAX_BODY || "4mb";

function publicUrl(req: Request): string {
  if (process.env.MINTIQ_PUBLIC_URL) return process.env.MINTIQ_PUBLIC_URL;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

/** Keep work alive after the response on Vercel; harmless elsewhere. */
async function keepAlive(p: Promise<unknown>): Promise<void> {
  try {
    const mod = await import("@vercel/functions");
    mod.waitUntil(p);
  } catch {
    /* not on Vercel */
  }
}

function sse(res: Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15000);
  return { send, close: () => { clearInterval(heartbeat); res.end(); } };
}

async function deliver(opts: { token: string; to: string | null; memo: DealMemo; intake: IntakeRequest; stats: RunStats | null; source: "ui" | "webhook" | "sample"; base: string }) {
  if (!opts.to) return { sent: false as const, reason: "no recipient" };
  const url = memoUrl(opts.base, opts.token);
  const result = await sendMemoEmail(opts.to, { memo: opts.memo, intake: opts.intake, url, stats: opts.stats, source: opts.source });
  if (result.sent) await markDelivered(opts.token, opts.to);
  else console.warn(`[mail] not sent to ${opts.to}: ${result.reason}`);
  return result;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: MAX_BODY }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      model: MODEL,
      has_key: Boolean(process.env.ANTHROPIC_API_KEY),
      store: storeMode(),
      mail: isMailConfigured(),
      webhook: Boolean(process.env.MINTIQ_WEBHOOK_SECRET),
      version: "0.2.0",
    });
  });

  app.get("/api/sample", (_req, res) => {
    res.json({ intake: SAMPLE_INTAKE, memo: SAMPLE_MEMO, replay: SAMPLE_REPLAY });
  });

  /** Read a saved memo by its share token. */
  app.get("/api/memos/:token", async (req, res) => {
    try {
      const rec = await getMemoByToken(req.params.token);
      if (!rec) { res.status(404).json({ error: "Memo not found (it may still be running)." }); return; }
      res.json({ token: rec.token, business_name: rec.business_name, source: rec.source, memo: rec.memo, stats: rec.stats, created_at: rec.created_at, intake: rec.intake });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Per-stage endpoints. The browser orchestrates: five Tier 1 calls in parallel, then cases,
   * then synthesis. Each call is its own function invocation, so no single request approaches
   * Vercel's duration cap. Every endpoint streams the same SSE events and ends with `stage_output`.
   */
  const stageHandler = (fn: (body: any, emit: (e: AgentEvent) => void, usage: Usage, signal: AbortSignal, req: Request) => Promise<void>) =>
    async (req: Request, res: Response) => {
      if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." }); return; }
      const { send, close } = sse(res);
      const controller = new AbortController();
      res.on("close", () => { if (!res.writableFinished) controller.abort(); });
      const usage: Usage = { input_tokens: 0, output_tokens: 0, searches: 0 };
      try {
        await fn(req.body ?? {}, send, usage, controller.signal, req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[stage]", message);
        send({ type: "error", message });
      } finally {
        send({ type: "done" });
        close();
      }
    };

  app.post("/api/stage/research", stageHandler(async (body, emit, usage, signal) => {
    const stage = body.stage as ResearchStage;
    if (!RESEARCH_STAGES.includes(stage)) throw new Error(`Unknown research stage: ${stage}`);
    const intake = body.intake as IntakeRequest;
    if (!intake?.business_name) throw new Error("business_name is required");
    const text = await runResearch(stage, { ...intake, files: [] }, emit, usage, signal);
    emit({ type: "stage_output", stage, text, usage });
  }));

  app.post("/api/stage/financials", stageHandler(async (body, emit, usage, signal) => {
    const intake = body.intake as IntakeRequest;
    if (!intake?.business_name) throw new Error("business_name is required");
    const text = await runFinancials(intake, emit, usage, signal);
    emit({ type: "stage_output", stage: "financials", text, usage });
  }));

  app.post("/api/stage/cases", stageHandler(async (body, emit, usage, signal) => {
    const intake = body.intake as IntakeRequest;
    const outputs = body.outputs as StageOutputs;
    if (!intake?.business_name || !outputs) throw new Error("intake and outputs are required");
    const text = await runCases(buildResearchPack({ ...intake, files: [] }, outputs), emit, usage, signal);
    emit({ type: "stage_output", stage: "cases", text, usage });
  }));

  app.post("/api/stage/synthesis", stageHandler(async (body, emit, usage, signal, req) => {
    const intake = body.intake as IntakeRequest;
    const outputs = body.outputs as StageOutputs;
    const cases = body.cases as string;
    if (!intake?.business_name || !outputs || !cases) throw new Error("intake, outputs, and cases are required");
    const prior = (body.prior_usage ?? { input_tokens: 0, output_tokens: 0, searches: 0 }) as Usage;
    const startedAt = Number(body.started_at) || Date.now();
    const memo = await runSynthesis(buildResearchPack({ ...intake, files: [] }, outputs), cases, emit, usage, signal);
    emit({ type: "memo", memo });
    const stats: RunStats = { duration_ms: Date.now() - startedAt, input_tokens: prior.input_tokens + usage.input_tokens, output_tokens: prior.output_tokens + usage.output_tokens, searches: prior.searches + usage.searches };
    emit({ type: "stats", ...stats });
    const base = publicUrl(req);
    const token = newToken();
    await saveMemo({ token, business_name: memo.business.legal_name || intake.business_name, source: "ui", intake: { ...intake, files: [] }, memo, stats, delivered_to: null });
    emit({ type: "saved", token, url: memoUrl(base, token) });
    if (intake.notify_email) await deliver({ token, to: intake.notify_email, memo, intake, stats, source: "ui", base });
  }));

  /** Single-request run (local / self-hosted). Streams committee events, then saves and optionally emails. */
  app.post("/api/analyze", async (req: Request, res: Response) => {
    const intake = req.body as IntakeRequest;
    if (!intake || typeof intake.business_name !== "string" || !intake.business_name.trim()) {
      res.status(400).json({ error: "business_name is required" });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server. Use the sample deal to preview MintIQ." });
      return;
    }
    const { send, close } = sse(res);
    const controller = new AbortController();
    // Abort only if the client goes away mid-run. (req "close" fires as soon as the body
    // is consumed on modern Node, which would cancel the committee immediately.)
    res.on("close", () => { if (!res.writableFinished) controller.abort(); });
    const base = publicUrl(req);
    try {
      let stats: RunStats | null = null;
      const memo = await runCommittee(intake, (e) => {
        if (e.type === "stats") stats = { duration_ms: e.duration_ms, input_tokens: e.input_tokens, output_tokens: e.output_tokens, searches: e.searches };
        send(e);
      }, controller.signal);
      const token = newToken();
      await saveMemo({ token, business_name: memo.business.legal_name || intake.business_name, source: "ui", intake, memo, stats, delivered_to: null });
      send({ type: "saved", token, url: memoUrl(base, token) });
      if (intake.notify_email) await deliver({ token, to: intake.notify_email, memo, intake, stats, source: "ui", base });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[analyze]", message);
      send({ type: "error", message });
    } finally {
      send({ type: "done" });
      close();
    }
  });

  /**
   * Intake webhook for Mint's pre-qualification form (or Zapier / Make / any form builder).
   * Auth: header `x-mintiq-secret` or query `?secret=` must equal MINTIQ_WEBHOOK_SECRET.
   * Responds 202 immediately with the memo URL; the committee runs in the background and
   * the memo is emailed to `notify_email` in the payload or MINTIQ_NOTIFY_TO when done.
   * Send `{"sample": true}` to exercise the loop with the fictional sample deal (no API cost).
   */
  app.post("/api/intake-webhook", async (req: Request, res: Response) => {
    const secret = process.env.MINTIQ_WEBHOOK_SECRET;
    if (!secret) { res.status(503).json({ error: "Webhook disabled: set MINTIQ_WEBHOOK_SECRET." }); return; }
    const provided = (req.headers["x-mintiq-secret"] as string | undefined) || (req.query.secret as string | undefined);
    if (provided !== secret) { res.status(401).json({ error: "Invalid webhook secret." }); return; }

    const sub = normalizeSubmission(req.body);
    const base = publicUrl(req);
    const to = sub.notify_to || defaultNotifyTo();

    if (sub.sample) {
      const token = newToken();
      const intake = { ...SAMPLE_INTAKE, notes: `${SAMPLE_INTAKE.notes}\n${sub.intake.notes ?? ""}`.trim() };
      await saveMemo({ token, business_name: SAMPLE_MEMO.business.legal_name, source: "sample", intake, memo: SAMPLE_MEMO, stats: null, delivered_to: null });
      const mail = await deliver({ token, to, memo: SAMPLE_MEMO, intake, stats: null, source: "sample", base });
      res.json({ status: "complete", sample: true, memo_url: memoUrl(base, token), email: mail });
      return;
    }

    if (!sub.intake.business_name) { res.status(400).json({ error: "Could not find a business name in the payload.", received: Object.keys(req.body ?? {}) }); return; }
    if (!process.env.ANTHROPIC_API_KEY) { res.status(503).json({ error: "ANTHROPIC_API_KEY is not configured on the server." }); return; }

    const token = newToken();
    const url = memoUrl(base, token);
    const job = (async () => {
      let stats: RunStats | null = null;
      try {
        const memo = await runCommittee(sub.intake, (e) => {
          if (e.type === "stats") stats = { duration_ms: e.duration_ms, input_tokens: e.input_tokens, output_tokens: e.output_tokens, searches: e.searches };
        });
        await saveMemo({ token, business_name: memo.business.legal_name || sub.intake.business_name, source: "webhook", intake: sub.intake, memo, stats, delivered_to: null });
        await deliver({ token, to, memo, intake: sub.intake, stats, source: "webhook", base });
        console.log(`[webhook] memo ready for ${sub.intake.business_name}: ${url}`);
      } catch (err) {
        console.error("[webhook] committee failed:", err instanceof Error ? err.message : err);
      }
    })();
    await keepAlive(job);

    res.status(202).json({ status: "queued", business_name: sub.intake.business_name, contact: sub.contact, memo_url: url, notify_to: to, eta_seconds: 240 });
  });

  return app;
}
