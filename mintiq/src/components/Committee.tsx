import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Brain, CheckCircle2, Circle, Loader2, AlertTriangle, SkipForward, FileSearch, Scale, PenLine, ArrowRight, Building2, Star, ShieldCheck, TrendingUp, FileSpreadsheet } from "lucide-react";
import { STAGES, type StageId } from "../../shared/schema";

export type FeedItem = { id: number; kind: "search" | "result" | "thinking"; text: string; titles?: string[] };
export type StageState = { status: "idle" | "running" | "done" | "skipped" | "error"; startedAt?: number; endedAt?: number; note?: string; feed: FeedItem[]; chars: number };
export type StageMap = Record<StageId, StageState>;

export function emptyStages(): StageMap {
  return Object.fromEntries(STAGES.map((s) => [s.id, { status: "idle", feed: [], chars: 0 }])) as unknown as StageMap;
}

const ICONS: Record<StageId, React.ComponentType<{ className?: string }>> = {
  profile: Building2, reputation: Star, records: ShieldCheck, industry: TrendingUp, financials: FileSpreadsheet, cases: Scale, synthesis: PenLine,
};

function useTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [active]);
}

function elapsed(s: StageState) {
  if (!s.startedAt) return "";
  const ms = (s.endedAt ?? Date.now()) - s.startedAt;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function StageCard({ id, state, wide }: { id: StageId; state: StageState; wide?: boolean }) {
  const meta = STAGES.find((s) => s.id === id)!;
  const Icon = ICONS[id];
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [state.feed.length]);

  const status = state.status;
  const ring = status === "running" ? "border-gold-400/60" : status === "done" ? "border-mint-500/50" : status === "error" ? "border-red-400/60" : "border-white/10";
  const searches = state.feed.filter((f) => f.kind === "search").length;

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`glass rounded-xl border ${ring} flex flex-col overflow-hidden ${wide ? "min-h-[150px]" : "min-h-[260px]"} ${status === "idle" ? "opacity-60" : ""}`}>
      <div className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <div className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${status === "running" ? "bg-gold-400/15 text-gold-300 pulse-ring" : status === "done" ? "bg-mint-500/15 text-mint-500" : "bg-white/5 text-navy-300"}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-navy-300 truncate">Tier {meta.tier} · {id === "financials" ? "Documents" : meta.tier === 1 ? "Web research" : meta.tier === 2 ? "Committee" : "Deal desk"}</div>
          <div className="text-sm font-semibold text-white leading-tight">{meta.label}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] font-mono text-white/70 tabular-nums">{elapsed(state)}</div>
          <div className="text-[10px] text-navy-300 flex items-center gap-1 justify-end">
            {status === "running" && <><Loader2 className="w-3 h-3 animate-spin text-gold-400" /> working</>}
            {status === "done" && <><CheckCircle2 className="w-3 h-3 text-mint-500" /> done</>}
            {status === "skipped" && <><SkipForward className="w-3 h-3" /> skipped</>}
            {status === "error" && <><AlertTriangle className="w-3 h-3 text-red-400" /> failed</>}
            {status === "idle" && <><Circle className="w-3 h-3" /> waiting</>}
          </div>
        </div>
      </div>
      <div ref={feedRef} className={`flex-1 overflow-y-auto thin-scrollbar px-4 py-3 space-y-2 ${wide ? "max-h-[160px]" : "max-h-[300px]"}`}>
        {state.note && <div className="text-xs text-navy-300 italic">{state.note}</div>}
        <AnimatePresence initial={false}>
          {state.feed.map((f) => (
            <motion.div key={f.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-xs leading-relaxed">
              {f.kind === "search" && (
                <div className="flex items-start gap-2 text-gold-200/90"><Search className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gold-400" /><span className="font-mono">{f.text}</span></div>
              )}
              {f.kind === "result" && (
                <div className="ml-5 pl-2 border-l border-gold-500/25 text-navy-300">
                  <div className="text-[11px]">{f.text}</div>
                  {f.titles?.map((t, i) => <div key={i} className="text-[11px] text-white/60 truncate">↳ {t}</div>)}
                </div>
              )}
              {f.kind === "thinking" && (
                <div className="flex items-start gap-2 text-white/80"><Brain className="w-3.5 h-3.5 mt-0.5 shrink-0 text-navy-300" /><span>{f.text}</span></div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {status === "running" && state.chars > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-navy-300"><FileSearch className="w-3 h-3" /> writing analysis · {(state.chars / 1000).toFixed(1)}k chars</div>
        )}
        {status === "running" && state.feed.length === 0 && state.chars === 0 && <div className="h-3 rounded shimmer" />}
      </div>
      {searches > 0 && <div className="px-4 py-2 border-t border-white/5 text-[10px] text-navy-300">{searches} web search{searches === 1 ? "" : "es"}</div>}
    </motion.div>
  );
}

export function Committee({ stages, running, businessName, model, memoReady, onViewMemo, startedAt, error }: {
  stages: StageMap; running: boolean; businessName: string; model: string; memoReady: boolean; onViewMemo: () => void; startedAt: number | null; error: string | null;
}) {
  useTick(running);
  const done = Object.values(stages).filter((s) => s.status === "done" || s.status === "skipped").length;
  const pct = Math.round((done / STAGES.length) * 100);
  const total = startedAt ? ((Date.now() - startedAt) / 1000) : 0;

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-gold-400 mb-1">Research committee · {model}</div>
          <h2 className="font-serif font-semibold text-4xl text-white leading-none">{businessName}</h2>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.2em] text-navy-300">Elapsed</div>
            <div className="font-mono text-white tabular-nums">{Math.floor(total / 60)}:{String(Math.floor(total % 60)).padStart(2, "0")}</div>
          </div>
          <div className="w-40">
            <div className="text-[10px] uppercase tracking-[0.2em] text-navy-300 mb-1 flex justify-between"><span>Progress</span><span>{pct}%</span></div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-gold-gradient transition-all duration-700" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3">
        {(["profile", "reputation", "records", "industry", "financials"] as const).map((id) => <StageCard key={id} id={id} state={stages[id]} />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <StageCard id="cases" state={stages.cases} wide />
        <StageCard id="synthesis" state={stages.synthesis} wide />
      </div>

      <AnimatePresence>
        {memoReady && (
          <motion.button initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onClick={onViewMemo}
            className="mt-6 w-full glass glow-gold rounded-xl px-6 py-5 flex items-center justify-between hover:bg-navy-800/70 transition group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-mint-500/15 flex items-center justify-center"><CheckCircle2 className="w-5 h-5 text-mint-500" /></div>
              <div className="text-left">
                <div className="font-semibold text-white">The deal memo is ready</div>
                <div className="text-sm text-navy-300">Fit score, recommended structure, cases, risk flags, and the audio briefing.</div>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-gold-400 transition group-hover:translate-x-1" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
