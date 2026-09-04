/** Radial fit-score gauge (0–100). Gold arc on a cream track; color is the number's job. */
export function FitGauge({ score, size = 168 }: { score: number; size?: number }) {
  const r = 62, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const tone = score >= 75 ? "#059669" : score >= 55 ? "#c9a84c" : "#b91c1c";
  const label = score >= 75 ? "Strong fit" : score >= 55 ? "Workable" : "Weak fit";
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={`Fit score ${score} of 100`}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="#e9e4d6" strokeWidth="12" />
        <circle
          cx="80" cy="80" r={r} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 80 80)"
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-serif font-semibold text-5xl leading-none text-navy-900 tabular-nums">{score}</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-navy-300 mt-1">out of 100</div>
        <div className="text-xs font-medium mt-1" style={{ color: tone }}>{label}</div>
      </div>
    </div>
  );
}
