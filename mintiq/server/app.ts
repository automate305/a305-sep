import express, { type Request, type Response } from "express";
import { runCommittee } from "./lib/pipeline.ts";
import { MODEL } from "./lib/claude.ts";
import { SAMPLE_MEMO, SAMPLE_INTAKE, SAMPLE_REPLAY } from "../shared/sample.ts";
import type { AgentEvent, IntakeRequest } from "../shared/schema.ts";

/** Vercel caps request bodies at ~4.5 MB; keep uploads comfortably under it. */
export const MAX_BODY = process.env.MINTIQ_MAX_BODY || "4mb";

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

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: MAX_BODY }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, model: MODEL, has_key: Boolean(process.env.ANTHROPIC_API_KEY), version: "0.1.0" });
  });

  app.get("/api/sample", (_req, res) => {
    res.json({ intake: SAMPLE_INTAKE, memo: SAMPLE_MEMO, replay: SAMPLE_REPLAY });
  });

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
    req.on("close", () => controller.abort());
    try {
      await runCommittee(intake, send, controller.signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[analyze]", message);
      send({ type: "error", message });
    } finally {
      send({ type: "done" });
      close();
    }
  });

  return app;
}
