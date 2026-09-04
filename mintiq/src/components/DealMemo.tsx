import { ArrowLeft, Printer, RotateCcw, ExternalLink, Link2, Check, AlertTriangle, AlertCircle, Info, CheckCircle2, Phone, ListChecks, Star, Building2, ShieldCheck, TrendingUp, FileSpreadsheet, Sparkles } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, LineChart, Line } from "recharts";
import type { DealMemo as Memo } from "../../shared/schema";
import { MfgLogo, MintIQLogo } from "./Logo";
import { useState } from "react";
import { FitGauge } from "./FitGauge";
import { Briefing } from "./Briefing";

export interface RunStats { duration_ms: number; input_tokens: number; output_tokens: number; searches: number }

const NAVY = "#1b2d63", GOLD = "#c9a84c", INK = "#0b1530", MUTED = "#6b7280", GRID = "#e9e4d6";
const usd = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;

const PRODUCTS = [
  { name: "Structured Term Loan", range: "$100K – $2M+", blurb: "Fixed monthly payments built for real business cycles." },
  { name: "Business Line of Credit", range: "$100K – $750K+", blurb: "Draw what you need, when the timing is right." },
  { name: "Strategic Financing", range: "$2M – $5M+ · 7–10 yrs", blurb: "Acquisition, recapitalization, and expansion structures." },
] as const;

function Section({ eyebrow, title, icon: Icon, children, className = "" }: { eyebrow?: string; title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-10 ${className}`}>
      <div className="flex items-end gap-3 mb-4">
        {Icon && <div className="w-8 h-8 rounded-lg bg-navy-900 text-gold-300 flex items-center justify-center"><Icon className="w-4 h-4" /></div>}
        <div>
          {eyebrow && <div className="text-[10px] uppercase tracking-[0.22em] text-gold-600">{eyebrow}</div>}
          <h2 className="font-serif font-semibold text-3xl text-navy-900 leading-none">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

const tip = { contentStyle: { borderRadius: 8, border: `1px solid ${GRID}`, fontSize: 12, color: INK }, cursor: { fill: "rgba(201,168,76,0.12)" } };

export function DealMemoView({ memo, stats, onBack, onReset, isSample, shareUrl }: { memo: Memo; stats: RunStats | null; onBack: (() => void) | null; onReset: () => void; isSample: boolean; shareUrl?: string | null }) {
  const v = memo.verdict, b = memo.business, fs = memo.financial_snapshot;
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this link", shareUrl); }
  };
  const sevIcon = { high: AlertTriangle, medium: AlertCircle, low: Info } as const;
  const sevTone = { high: "text-red-700 bg-red-50 border-red-200", medium: "text-amber-800 bg-amber-50 border-amber-200", low: "text-navy-700 bg-cream-100 border-cream-200" } as const;

  return (
    <div className="memo-root min-h-full h-full overflow-y-auto bg-cream-50 text-navy-900 font-sans">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-cream-50/90 backdrop-blur border-b border-cream-200 print-hidden">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <MintIQLogo tone="dark" height={34} />
            <div className="hidden md:block h-8 w-px bg-cream-200" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-600">MintIQ deal memo{isSample ? " · sample (fictional)" : ""}</div>
              <div className="font-semibold truncate">{b.legal_name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onBack && <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-cream-200 hover:bg-white"><ArrowLeft className="w-4 h-4" /> Timeline</button>}
            {shareUrl && <button onClick={copyLink} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-cream-200 hover:bg-white">{copied ? <Check className="w-4 h-4 text-mint-600" /> : <Link2 className="w-4 h-4" />} {copied ? "Copied" : "Share"}</button>}
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-cream-200 hover:bg-white"><Printer className="w-4 h-4" /> PDF</button>
            <button onClick={onReset} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-navy-900 text-white hover:bg-navy-800"><RotateCcw className="w-4 h-4" /> New</button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Print-only masthead */}
        <div className="hidden print:flex items-center justify-between mb-8"><MfgLogo tone="dark" height={48} /><div className="text-xs text-gray-500">MintIQ Deal Memo · {new Date().toLocaleDateString()}</div></div>

        {/* Hero */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card p-8">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded bg-navy-900 text-gold-300">{b.mint_industry_bucket}</span>
              <span className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded bg-cream-100 text-navy-700">{b.location}</span>
              {b.years_in_business && <span className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded bg-cream-100 text-navy-700">{b.years_in_business}</span>}
            </div>
            <h1 className="font-serif font-semibold text-4xl md:text-[2.75rem] leading-[1.05] text-navy-900">{v.headline}</h1>
            <p className="mt-5 text-[17px] leading-relaxed text-navy-800/90">{v.summary}</p>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[["Industry", b.industry], ["Revenue", b.estimated_annual_revenue ?? "Not verified"], ["Employees", b.employees ?? "Not verified"], ["Entity status", b.entity_status ?? "Not verified"]].map(([k, val]) => (
                <div key={k} className="bg-cream-100 rounded-lg p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-gold-700">{k}</div><div className="mt-1 text-navy-900 leading-snug">{val}</div></div>
              ))}
            </div>
          </div>

          <div className="card p-6 flex flex-col items-center text-center bg-white">
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold-600">Pre-underwriting fit</div>
            <div className="mt-3"><FitGauge score={v.fit_score} /></div>
            <div className="mt-2 text-xs text-navy-300">Confidence: <span className="text-navy-900 font-medium capitalize">{v.confidence}</span></div>
            <div className="mt-5 w-full rounded-xl bg-navy-900 text-white p-4 text-left">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-400">Recommended product</div>
              <div className="font-serif font-semibold text-2xl leading-tight mt-1">{v.recommended_product}</div>
              <div className="text-gold-300 font-medium mt-1">{v.suggested_range}</div>
              <div className="text-xs text-white/75 mt-2 leading-relaxed">{v.recommended_structure}</div>
            </div>
          </div>
        </div>

        {/* Product strip */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRODUCTS.map((p) => {
            const rec = p.name === v.recommended_product;
            return (
              <div key={p.name} className={`rounded-xl p-4 border ${rec ? "border-gold-500 bg-white shadow-lg shadow-gold-500/15" : "border-cream-200 bg-cream-100/60 opacity-75"}`}>
                <div className="flex items-center justify-between"><div className="font-semibold">{p.name}</div>{rec && <span className="text-[10px] uppercase tracking-[0.18em] text-navy-950 bg-gold-gradient px-2 py-0.5 rounded">Recommended</span>}</div>
                <div className="text-xs text-gold-700 mt-0.5">{p.range}</div>
                <div className="text-xs text-navy-700 mt-2">{p.blurb}</div>
              </div>
            );
          })}
        </div>

        {/* Takeaways / talking points / next steps */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-[0.22em] text-gold-600"><CheckCircle2 className="w-3.5 h-3.5" /> Key takeaways</div>
            <ul className="space-y-2.5 text-sm text-navy-800">{v.key_takeaways.map((t, i) => <li key={i} className="flex gap-2"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-gold-500 shrink-0" />{t}</li>)}</ul>
          </div>
          <div className="card p-6 bg-navy-900 text-white border-navy-700">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-[0.22em] text-gold-400"><Phone className="w-3.5 h-3.5" /> First-call talking points</div>
            <ul className="space-y-3 text-sm">{v.talking_points.map((t, i) => <li key={i} className="font-serif text-lg leading-snug italic text-white/95">“{t}”</li>)}</ul>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-[0.22em] text-gold-600"><ListChecks className="w-3.5 h-3.5" /> Next steps</div>
            <ol className="space-y-2.5 text-sm text-navy-800">{v.next_steps.map((t, i) => <li key={i} className="flex gap-3"><span className="font-mono text-gold-600 text-xs pt-0.5">{String(i + 1).padStart(2, "0")}</span>{t}</li>)}</ol>
          </div>
        </div>

        {/* Score breakdown */}
        <Section eyebrow="How the score was built" title="Fit score breakdown" icon={Sparkles}>
          <div className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
            {memo.score_breakdown.map((s) => (
              <div key={s.factor}>
                <div className="flex justify-between text-sm"><span className="font-medium">{s.factor}</span><span className="font-mono text-navy-700">{s.score}/10</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-cream-200 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${s.score * 10}%`, background: s.score >= 7 ? "#059669" : s.score >= 5 ? GOLD : "#b91c1c" }} /></div>
                <div className="mt-1 text-xs text-navy-700/80">{s.rationale}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Cases */}
        <Section eyebrow="Credit committee" title="Upside, downside, base case" icon={TrendingUp}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([["upside", memo.cases.upside, "border-t-4 border-t-mint-600"], ["downside", memo.cases.downside, "border-t-4 border-t-red-700"], ["base", memo.cases.base, "border-t-4 border-t-navy-700"]] as const).map(([k, c, cls]) => (
              <div key={k} className={`card p-6 ${cls}`}>
                <div className="text-[10px] uppercase tracking-[0.22em] text-gold-600">{k} case</div>
                <div className="font-serif font-semibold text-2xl mt-1 leading-tight">{c.title}</div>
                <p className="mt-3 text-sm text-navy-800 leading-relaxed">{c.thesis}</p>
                <ul className="mt-4 space-y-1.5 text-xs text-navy-700">{c.drivers.map((d, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gold-500 shrink-0" />{d}</li>)}</ul>
              </div>
            ))}
          </div>
        </Section>

        {/* Financials */}
        {fs ? (
          <Section eyebrow={`From ${fs.documents_reviewed.length} document${fs.documents_reviewed.length === 1 ? "" : "s"}`} title="Financial snapshot" icon={FileSpreadsheet}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {fs.metrics.map((m) => (
                <div key={m.label} className="card p-4"><div className="text-[10px] uppercase tracking-[0.16em] text-gold-700 leading-tight">{m.label}</div><div className="font-serif font-semibold text-2xl mt-1 text-navy-900">{m.value}</div>{m.note && <div className="text-[11px] text-navy-700/80 mt-1">{m.note}</div>}</div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {fs.monthly_deposits.length > 0 && (
                <div className="card p-5 lg:col-span-2">
                  <div className="font-semibold">Monthly deposits</div><div className="text-xs text-navy-700/80 mb-3">Operating account, oldest to newest</div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fs.monthly_deposits} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} tickFormatter={(n) => usd(Number(n))} width={44} />
                        <Tooltip {...tip} formatter={(val) => [usd(Number(val)), "Deposits"]} />
                        <Bar dataKey="deposits" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={44}>
                          <LabelList dataKey="deposits" position="top" formatter={(n) => usd(Number(n))} style={{ fontSize: 11, fill: INK }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {fs.revenue_trend.length > 0 && (
                <div className="card p-5">
                  <div className="font-semibold">Revenue trend</div><div className="text-xs text-navy-700/80 mb-3">As reported in documents</div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fs.revenue_trend} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: MUTED }} interval={0} />
                        <YAxis hide />
                        <Tooltip {...tip} formatter={(val) => [usd(Number(val)), "Revenue"]} />
                        <Bar dataKey="revenue" fill={GOLD} radius={[4, 4, 0, 0]} maxBarSize={40}>
                          <LabelList dataKey="revenue" position="top" formatter={(n) => usd(Number(n))} style={{ fontSize: 11, fill: INK }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card p-5 lg:col-span-2 overflow-x-auto">
                <div className="font-semibold mb-3">Existing obligations</div>
                {fs.existing_obligations.length === 0 ? <div className="text-sm text-navy-700/80">None identified in the documents.</div> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-[10px] uppercase tracking-[0.16em] text-gold-700 text-left"><th className="pb-2 font-medium">Creditor</th><th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium">Payment</th><th className="pb-2 font-medium">Frequency</th></tr></thead>
                    <tbody>{fs.existing_obligations.map((o, i) => {
                      const mca = /cash advance|mca|factoring/i.test(o.type);
                      return <tr key={i} className="border-t border-cream-200"><td className="py-2 font-medium">{o.creditor}</td><td className="py-2">{mca ? <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle className="w-3.5 h-3.5" />{o.type}</span> : o.type}</td><td className="py-2 font-mono">{o.payment}</td><td className="py-2 text-navy-700">{o.frequency}</td></tr>;
                    })}</tbody>
                  </table>
                )}
              </div>
              <div className="card p-5">
                {fs.monthly_deposits.some((m) => m.ending_balance !== null) && (
                  <div className="h-28 mb-3">
                    <div className="font-semibold text-sm">Ending balance</div>
                    <ResponsiveContainer width="100%" height="85%">
                      <LineChart data={fs.monthly_deposits} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                        <XAxis dataKey="month" hide /><YAxis hide domain={["auto", "auto"]} />
                        <Tooltip {...tip} formatter={(val) => [usd(Number(val)), "Ending balance"]} />
                        <Line type="monotone" dataKey="ending_balance" stroke={GOLD} strokeWidth={2} dot={{ r: 3, fill: GOLD, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-[0.16em] text-gold-700">NSF / returned items</div>
                <div className="font-serif font-semibold text-3xl">{fs.nsf_count ?? "—"}</div>
                <div className="mt-3 text-xs text-navy-700 leading-relaxed">{fs.analyst_notes}</div>
                <div className="mt-3 text-[11px] text-navy-300">Reviewed: {fs.documents_reviewed.join(" · ")}</div>
              </div>
            </div>
          </Section>
        ) : (
          <Section eyebrow="No documents uploaded" title="Financial snapshot" icon={FileSpreadsheet}>
            <div className="card p-6 text-sm text-navy-700">No bank statements or financials were provided, so cash-flow metrics are unverified and the fit score confidence is reduced. Upload a six-month bank package and the last two P&Ls to unlock deposit trends, DSCR, and MCA detection.</div>
          </Section>
        )}

        {/* Risk flags + reputation */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <Section eyebrow="Prioritized" title="Risk flags" icon={ShieldCheck} className="lg:col-span-3">
            <div className="space-y-3">
              {memo.risk_flags.length === 0 && <div className="card p-5 text-sm text-navy-700">No material risk flags surfaced.</div>}
              {memo.risk_flags.map((r, i) => { const I = sevIcon[r.severity]; return (
                <div key={i} className={`rounded-xl border p-4 flex gap-3 ${sevTone[r.severity]}`}>
                  <I className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-semibold">{r.title}</span><span className="text-[10px] uppercase tracking-[0.16em] opacity-70">{r.severity}</span></div><div className="text-sm mt-1 opacity-90">{r.description}</div>{r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs mt-1 underline opacity-80">Source <ExternalLink className="w-3 h-3" /></a>}</div>
                </div>
              ); })}
            </div>
          </Section>
          <Section eyebrow="Social proof" title="Reputation" icon={Star} className="lg:col-span-2">
            <div className="card p-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["Google", memo.reputation.google_rating !== null ? `${memo.reputation.google_rating.toFixed(1)}★` : "—", memo.reputation.google_review_count !== null ? `${memo.reputation.google_review_count} reviews` : "not found"], ["Yelp", memo.reputation.yelp_rating !== null ? `${memo.reputation.yelp_rating.toFixed(1)}★` : "—", memo.reputation.yelp_rating !== null ? "rating" : "not found"], ["BBB", memo.reputation.bbb_rating ?? "—", memo.reputation.bbb_rating ? "rating" : "not found"]].map(([k, val, sub]) => (
                  <div key={k} className="bg-cream-100 rounded-lg p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-gold-700">{k}</div><div className="font-serif font-semibold text-2xl leading-tight mt-1">{val}</div><div className="text-[10px] text-navy-700/80">{sub}</div></div>
                ))}
              </div>
              <p className="mt-4 text-sm text-navy-800 leading-relaxed">{memo.reputation.sentiment_summary}</p>
              <ul className="mt-3 space-y-1.5 text-xs text-navy-700">{memo.reputation.highlights.map((h, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gold-500 shrink-0" />{h}</li>)}</ul>
            </div>
          </Section>
        </div>

        {/* Findings */}
        <Section eyebrow="Sourced evidence" title="Research findings" icon={Building2}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {memo.findings.map((f, i) => (
              <div key={i} className="card p-4">
                <div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded bg-navy-900 text-gold-300">{f.category}</span>{f.date && <span className="text-[11px] font-mono text-navy-300">{f.date}</span>}</div>
                <div className="font-semibold mt-2 leading-snug">{f.title}</div>
                <div className="text-sm text-navy-700 mt-1 leading-relaxed">{f.detail}</div>
                {f.source_url && <a href={f.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs mt-2 text-gold-700 hover:underline truncate max-w-full"><ExternalLink className="w-3 h-3 shrink-0" />{f.source_url.replace(/^https?:\/\//, "").slice(0, 60)}</a>}
              </div>
            ))}
          </div>
        </Section>

        {/* Borrower profile */}
        <Section eyebrow="Verified where possible" title="Borrower profile" icon={Building2}>
          <div className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3 text-sm">
            {[["Legal name", b.legal_name], ["DBA", b.dba], ["Website", b.website], ["Location", b.location], ["Ownership", b.ownership], ["Entity status", b.entity_status], ["Years in business", b.years_in_business], ["Employees", b.employees]].map(([k, val]) => (
              <div key={k as string} className="flex justify-between gap-4 border-b border-cream-200 py-1.5"><span className="text-navy-700/80">{k}</span><span className="text-right font-medium">{val ?? <span className="text-navy-300 font-normal">not verified</span>}</span></div>
            ))}
            <div className="md:col-span-2 pt-2"><div className="text-[10px] uppercase tracking-[0.18em] text-gold-700 mb-1.5">Licenses & registrations</div>{b.licenses.length ? <ul className="flex flex-wrap gap-2">{b.licenses.map((l, i) => <li key={i} className="text-xs bg-cream-100 rounded px-2 py-1">{l}</li>)}</ul> : <div className="text-xs text-navy-300">None found</div>}</div>
          </div>
        </Section>

        {/* Briefing */}
        <div className="mt-10"><Briefing lines={memo.briefing_script} /></div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-cream-200 text-xs text-navy-700/80">
          <p className="leading-relaxed">{memo.disclaimer}</p>
          {stats && <p className="mt-2 font-mono text-[11px] text-navy-300">Committee ran {(stats.duration_ms / 1000).toFixed(0)}s · {stats.searches} web searches · {((stats.input_tokens + stats.output_tokens) / 1000).toFixed(0)}k tokens</p>}
          <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-2">
            <MfgLogo tone="dark" height={34} />
            <div className="text-navy-700">MintIQ · From Miami with love. 🤍 <span className="text-navy-300">Built by Automate305</span></div>
          </div>
        </footer>
      </div>
    </div>
  );
}
