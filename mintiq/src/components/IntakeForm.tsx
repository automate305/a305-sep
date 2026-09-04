import { useRef, useState } from "react";
import { FileText, Upload, X, Sparkles, ArrowRight, Building2, Globe, MapPin, DollarSign } from "lucide-react";
import type { IntakeFile, IntakeRequest } from "../../shared/schema";
import { MINT_INDUSTRIES } from "../../shared/schema";

/** Vercel functions accept ~4.5 MB bodies; base64 inflates by 4/3, so cap the raw bytes. */
const MAX_UPLOAD_BYTES = 2.8 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt";

const STATES = ["FL", "GA", "TX", "NY", "NJ", "CA", "NC", "SC", "AL", "TN", "IL", "PA", "OH", "AZ", "CO", "Other"];

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function mediaTypeFor(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv", txt: "text/plain" } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

export function IntakeForm({ onRun, onSample, busy, hasKey }: { onRun: (intake: IntakeRequest) => void; onSample: () => void; busy: boolean; hasKey: boolean | null }) {
  const [form, setForm] = useState<IntakeRequest>({ business_name: "", website: "", city: "", state: "FL", industry: "Specialty Trade Contractors", requested_amount: "", use_of_funds: "", notes: "", notify_email: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof IntakeRequest) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 6);
    const bytes = next.reduce((n, f) => n + f.size, 0);
    if (bytes > MAX_UPLOAD_BYTES) { setErr(`Uploads are capped at ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(1)} MB total for the hosted demo. Compress the PDFs or drop a file.`); return; }
    setErr(null);
    setFiles(next);
  };

  const submit = async () => {
    if (!form.business_name.trim()) { setErr("Enter the business name."); return; }
    setErr(null);
    const encoded: IntakeFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, media_type: mediaTypeFor(f), data: await toBase64(f) })));
    onRun({ ...form, business_name: form.business_name.trim(), notify_email: form.notify_email?.trim() || undefined, files: encoded });
  };

  const field = "w-full bg-navy-900/60 border border-gold-500/20 focus:border-gold-400/70 focus:ring-2 focus:ring-gold-400/20 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-navy-300/70 outline-none transition";
  const label = "text-[11px] uppercase tracking-[0.18em] text-gold-300/80 font-medium mb-1.5 flex items-center gap-1.5";

  return (
    <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
      {/* Left: pitch */}
      <div className="lg:col-span-2 pt-2">
        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-gold-400 mb-5">
          <Sparkles className="w-3.5 h-3.5" /> Borrower intelligence desk
        </div>
        <h1 className="font-serif font-semibold text-5xl md:text-6xl leading-[0.98] text-white">
          Know the borrower <span className="italic text-gold-gradient">before</span> the first call.
        </h1>
        <p className="mt-6 text-navy-300 text-lg leading-relaxed max-w-md">
          MintIQ runs a five-analyst research committee on any applicant: entity and licenses, reputation, public records and UCC positions, industry context, and the financials you upload. It argues the upside, downside, and base case, then hands you a structured deal memo with the product and structure to pitch.
        </p>
        <ul className="mt-8 space-y-3 text-sm text-white/80">
          {[
            "Pre-underwriting fit score with the arithmetic shown",
            "Spots stacked MCA positions and quantifies the consolidation relief",
            "Maps every applicant to Term Loan, Line of Credit, or Strategic Financing",
            "Sixty-second audio briefing for the deal desk",
          ].map((t) => (
            <li key={t} className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-gold-400 shrink-0" />{t}</li>
          ))}
        </ul>
        <button onClick={onSample} disabled={busy} className="mt-10 group inline-flex items-center gap-2 text-sm text-gold-300 hover:text-gold-200 transition disabled:opacity-50">
          Watch the sample deal <ArrowRight className="w-4 h-4 transition group-hover:translate-x-0.5" />
        </button>
        {hasKey === false && (
          <p className="mt-3 text-xs text-navy-300 max-w-sm">No Claude API key is configured on this deployment, so live analysis is disabled. The sample deal runs fully offline.</p>
        )}
      </div>

      {/* Right: form */}
      <div className="lg:col-span-3 glass rounded-2xl p-6 md:p-8 glow-gold">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <div className={label}><Building2 className="w-3 h-3" /> Business name</div>
            <input className={field} value={form.business_name} onChange={set("business_name")} placeholder="e.g. Coastal Breeze Mechanical, LLC" onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          <div>
            <div className={label}><Globe className="w-3 h-3" /> Website</div>
            <input className={field} value={form.website} onChange={set("website")} placeholder="company.com" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <div className={label}><MapPin className="w-3 h-3" /> City</div>
              <input className={field} value={form.city} onChange={set("city")} placeholder="Fort Lauderdale" />
            </div>
            <div>
              <div className={label}>State</div>
              <select className={field} value={form.state} onChange={set("state")}>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
          </div>
          <div>
            <div className={label}>Industry</div>
            <select className={field} value={form.industry} onChange={set("industry")}>{MINT_INDUSTRIES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <div>
            <div className={label}><DollarSign className="w-3 h-3" /> Requested capital</div>
            <input className={field} value={form.requested_amount} onChange={set("requested_amount")} placeholder="$650,000" />
          </div>
          <div className="md:col-span-2">
            <div className={label}>Use of funds</div>
            <input className={field} value={form.use_of_funds} onChange={set("use_of_funds")} placeholder="Consolidate two MCAs, add three vans, buy a crane truck" />
          </div>
          <div className="md:col-span-2">
            <div className={label}>Advisor notes</div>
            <textarea className={`${field} min-h-[64px] resize-y`} value={form.notes} onChange={set("notes")} placeholder="Referral source, what the bank said, anything the owner mentioned" />
          </div>
          <div className="md:col-span-2">
            <div className={label}>Email the memo to <span className="text-navy-300/70 normal-case tracking-normal">(optional)</span></div>
            <input type="email" className={field} value={form.notify_email} onChange={set("notify_email")} placeholder="felipe@mintfinancialgroup.com" />
          </div>

          <div className="md:col-span-2">
            <div className={label}><FileText className="w-3 h-3" /> Financial documents <span className="text-navy-300/70 normal-case tracking-normal">(optional: bank statements, P&L, tax returns)</span></div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-xl border border-dashed px-4 py-5 text-center transition ${drag ? "border-gold-400 bg-gold-400/10" : "border-gold-500/30 hover:border-gold-400/60 bg-navy-900/40"}`}
            >
              <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <Upload className="w-5 h-5 mx-auto text-gold-400 mb-2" />
              <div className="text-sm text-white/90">Drop PDFs or images here, or click to browse</div>
              <div className="text-[11px] text-navy-300 mt-1">Up to 6 files · {(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(1)} MB total · processed in memory, never stored</div>
            </div>
            {files.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between text-xs bg-navy-900/60 border border-gold-500/15 rounded-lg px-3 py-2">
                    <span className="flex items-center gap-2 text-white/85 truncate"><FileText className="w-3.5 h-3.5 text-gold-400 shrink-0" />{f.name}<span className="text-navy-300">{(f.size / 1024).toFixed(0)} KB</span></span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-navy-300 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                  </li>
                ))}
                <li className="text-[11px] text-navy-300 text-right">{(totalBytes / 1024 / 1024).toFixed(2)} MB of {(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(1)} MB</li>
              </ul>
            )}
          </div>
        </div>

        {err && <div className="mt-4 text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{err}</div>}

        <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="text-[11px] text-navy-300 max-w-xs">Runs four web-research analysts and a financial analyst in parallel, then a credit committee. Typically two to four minutes.</div>
          <button onClick={submit} disabled={busy || hasKey === false} className="bg-gold-gradient text-navy-950 font-semibold px-6 py-3 rounded-lg text-sm tracking-wide hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-gold-500/20">
            Convene the committee <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
