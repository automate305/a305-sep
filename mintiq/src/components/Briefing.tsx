import { useEffect, useState } from "react";
import { Play, Square, Headphones, Volume2 } from "lucide-react";
import { speakBriefing, supportsSpeech, type BriefingLine } from "../lib/speech";

export function Briefing({ lines }: { lines: BriefingLine[] }) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState<number>(-1);
  const [stop, setStop] = useState<(() => void) | null>(null);
  const ok = supportsSpeech();

  useEffect(() => () => { stop?.(); }, [stop]);

  const start = () => {
    if (!ok) return;
    const cancel = speakBriefing(lines, setCurrent, () => { setPlaying(false); setCurrent(-1); });
    setStop(() => cancel);
    setPlaying(true);
  };
  const halt = () => { stop?.(); setPlaying(false); setCurrent(-1); };

  return (
    <div className="rounded-xl border border-navy-700 p-6 md:p-7 text-white" style={{ background: "#0b1530" }}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-gold-400/15 flex items-center justify-center"><Headphones className="w-5 h-5 text-gold-300" /></div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold-400">Deal desk briefing</div>
            <div className="font-serif font-semibold text-2xl leading-tight">Sixty-second audio brief</div>
          </div>
        </div>
        <div className="flex items-center gap-3 print-hidden">
          {playing ? (
            <button onClick={halt} className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 px-4 py-2.5 rounded-lg text-sm"><Square className="w-4 h-4" /> Stop</button>
          ) : (
            <button onClick={start} disabled={!ok} className="inline-flex items-center gap-2 bg-gold-gradient text-navy-950 font-semibold px-5 py-2.5 rounded-lg text-sm hover:brightness-110 disabled:opacity-50"><Play className="w-4 h-4" /> Play briefing</button>
          )}
          {!ok && <span className="text-xs text-navy-300">Speech playback is not supported in this browser.</span>}
        </div>
      </div>
      <div className="space-y-2.5">
        {lines.map((l, i) => (
          <div key={i} className={`flex gap-3 rounded-lg px-3 py-2 transition ${i === current ? "bg-gold-400/15" : ""}`}>
            <div className={`w-16 shrink-0 text-[10px] uppercase tracking-[0.18em] pt-1 ${l.speaker === "Analyst" ? "text-gold-300" : "text-silver-400"}`}>{l.speaker}</div>
            <div className={`text-sm leading-relaxed ${i === current ? "text-white" : "text-white/80"}`}>{i === current && <Volume2 className="inline w-3.5 h-3.5 mr-1.5 text-gold-300" />}{l.line}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
