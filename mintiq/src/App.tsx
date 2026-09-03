import { useEffect, useRef, useState } from "react";
import { Background } from "./components/Background";
import { MfgLogo } from "./components/Logo";
import { IntakeForm } from "./components/IntakeForm";
import { Committee, emptyStages, type StageMap } from "./components/Committee";
import { DealMemoView, type RunStats } from "./components/DealMemo";
import { analyze, fetchSample, health, replay } from "./lib/api";
import type { AgentEvent, DealMemo, IntakeRequest } from "../shared/schema";

type View = "intake" | "committee" | "memo";

export default function App() {
  const [view, setView] = useState<View>("intake");
  const [stages, setStages] = useState<StageMap>(emptyStages());
  const [running, setRunning] = useState(false);
  const [memo, setMemo] = useState<DealMemo | null>(null);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [model, setModel] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const feedId = useRef(0);

  useEffect(() => { health().then((h) => setHasKey(h.has_key)).catch(() => setHasKey(false)); }, []);

  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case "run_start": setModel(e.model); setBusinessName(e.business_name); break;
      case "stage":
        setStages((s) => {
          const cur = s[e.stage];
          if (e.status === "start") return { ...s, [e.stage]: { ...cur, status: "running", startedAt: Date.now() } };
          return { ...s, [e.stage]: { ...cur, status: e.status, endedAt: Date.now(), note: e.note ?? cur.note } };
        });
        break;
      case "search":
        setStages((s) => ({ ...s, [e.stage]: { ...s[e.stage], feed: [...s[e.stage].feed, { id: feedId.current++, kind: "search", text: e.query }] } }));
        break;
      case "search_result":
        setStages((s) => ({ ...s, [e.stage]: { ...s[e.stage], feed: [...s[e.stage].feed, { id: feedId.current++, kind: "result", text: `${e.count} result${e.count === 1 ? "" : "s"}`, titles: e.titles }] } }));
        break;
      case "thinking":
        setStages((s) => ({ ...s, [e.stage]: { ...s[e.stage], feed: [...s[e.stage].feed, { id: feedId.current++, kind: "thinking", text: e.text }] } }));
        break;
      case "text":
        setStages((s) => ({ ...s, [e.stage]: { ...s[e.stage], chars: s[e.stage].chars + e.text.length } }));
        break;
      case "memo": setMemo(e.memo); break;
      case "stats": setStats({ duration_ms: e.duration_ms, input_tokens: e.input_tokens, output_tokens: e.output_tokens, searches: e.searches }); break;
      case "error": setError(e.message); break;
      case "done": setRunning(false); break;
    }
  };

  const begin = (name: string, sample: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStages(emptyStages()); setMemo(null); setStats(null); setError(null);
    setBusinessName(name); setIsSample(sample); setStartedAt(Date.now()); setRunning(true); setView("committee");
    return controller;
  };

  const run = async (intake: IntakeRequest) => {
    const controller = begin(intake.business_name, false);
    try {
      await analyze(intake, onEvent, controller.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const runSample = async () => {
    const controller = begin("Coastal Breeze Mechanical, LLC", true);
    try {
      const sample = await fetchSample();
      await replay(sample.replay, onEvent, controller.signal);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const reset = () => { abortRef.current?.abort(); setRunning(false); setView("intake"); setMemo(null); setStages(emptyStages()); setError(null); };

  // Auto-open the memo the first time it lands.
  useEffect(() => { if (memo && view === "committee") { const t = setTimeout(() => setView("memo"), 1200); return () => clearTimeout(t); } }, [memo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view === "memo" && memo) {
    return <div className="h-screen"><DealMemoView memo={memo} stats={stats} isSample={isSample} onBack={() => setView("committee")} onReset={reset} /></div>;
  }

  return (
    <div className="relative min-h-screen bg-navy-950 text-white overflow-hidden flex flex-col">
      <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_20%_-10%,rgba(27,45,99,.55),transparent),radial-gradient(900px_500px_at_100%_110%,rgba(201,168,76,.14),transparent)]" />
      <Background />
      <header className="relative z-20 px-6 md:px-10 py-4 flex items-center justify-between border-b border-white/5">
        <button onClick={reset} className="flex items-center gap-4"><MfgLogo tone="light" height={52} /><span className="hidden md:inline-block h-7 w-px bg-white/15" /><span className="hidden md:inline font-serif text-2xl font-semibold tracking-tight">Mint<span className="text-gold-gradient">IQ</span></span></button>
        <div className="flex items-center gap-4 text-xs text-navy-300">
          {view === "committee" && memo && <button onClick={() => setView("memo")} className="text-gold-300 hover:text-gold-200">Open memo →</button>}
          {view === "committee" && <button onClick={reset} className="hover:text-white">{running ? "Cancel" : "New analysis"}</button>}
          <span className="hidden sm:inline">Sunrise, FL · 855-333-6468</span>
        </div>
      </header>
      <main className="relative z-10 flex-1 overflow-y-auto thin-scrollbar px-6 md:px-10 py-10 md:py-14">
        {view === "intake" && <IntakeForm onRun={run} onSample={runSample} busy={running} hasKey={hasKey} />}
        {view === "committee" && <Committee stages={stages} running={running} businessName={businessName} model={model} memoReady={!!memo} onViewMemo={() => setView("memo")} startedAt={startedAt} error={error} />}
      </main>
      <footer className="relative z-10 px-6 md:px-10 py-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-navy-300">
        <span>MintIQ can make mistakes. It is pre-underwriting research, not a credit decision.</span>
        <span>From Miami with love. 🤍 <span className="text-white/50">Built by Automate305</span></span>
      </footer>
    </div>
  );
}
