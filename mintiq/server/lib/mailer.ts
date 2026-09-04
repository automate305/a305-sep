import nodemailer, { type Transporter } from "nodemailer";
import type { DealMemo, IntakeRequest } from "../../shared/schema.js";
import type { RunStats } from "./store.js";

/**
 * Memo delivery over SMTP. Defaults match the Hostinger setup used elsewhere in
 * a305-sep (smtp.hostinger.com:465). Configure with MINTIQ_SMTP_USER / MINTIQ_SMTP_PASS.
 */

function cfg() {
  const user = process.env.MINTIQ_SMTP_USER;
  const pass = process.env.MINTIQ_SMTP_PASS;
  const host = process.env.MINTIQ_SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.MINTIQ_SMTP_PORT || 465);
  const from = process.env.MINTIQ_FROM || (user ? `MintIQ <${user}>` : "");
  return { user, pass, host, port, from };
}

export function isMailConfigured(): boolean {
  const c = cfg();
  return Boolean(c.user && c.pass);
}

/** Default recipient(s) for webhook-generated memos, comma-separated. */
export function defaultNotifyTo(): string | null {
  return process.env.MINTIQ_NOTIFY_TO || null;
}

let _transport: Transporter | null = null;
function transport(): Transporter {
  if (_transport) return _transport;
  const c = cfg();
  _transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
  return _transport;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

export interface MemoEmailInput { memo: DealMemo; intake: IntakeRequest; url: string; stats: RunStats | null; source: "ui" | "webhook" | "sample" }

export function renderMemoEmail({ memo, intake, url, stats, source }: MemoEmailInput): { subject: string; html: string; text: string } {
  const v = memo.verdict, b = memo.business;
  const tone = v.fit_score >= 75 ? "#059669" : v.fit_score >= 55 ? "#c9a84c" : "#b91c1c";
  const flags = memo.risk_flags.slice(0, 3);
  const subject = `MintIQ memo · ${b.legal_name} · fit ${v.fit_score}/100 · ${v.recommended_product}`;
  const li = (items: string[]) => items.map((t) => `<li style="margin:0 0 8px 0;">${esc(t)}</li>`).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f2ea;font-family:'DM Sans',Helvetica,Arial,sans-serif;color:#0b1530;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ea;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e9e4d6;">
  <tr><td style="background:#0b1530;padding:22px 28px;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#f5f2ea;letter-spacing:-0.5px;">Mint<span style="color:#ebb43b;">IQ</span></div>
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-top:4px;">Deal memo · ${source === "sample" ? "sample (fictional)" : source === "webhook" ? "new pre-qualification" : "advisor run"}</div>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#ebb43b,#c9a84c,#a88656);font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:26px 28px 8px 28px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a88656;">${esc(b.mint_industry_bucket)} · ${esc(b.location)}</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;line-height:1.2;margin:6px 0 4px 0;">${esc(b.legal_name)}</div>
    <div style="font-size:16px;line-height:1.45;color:#1b2d63;">${esc(v.headline)}</div>
  </td></tr>
  <tr><td style="padding:14px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="34%" valign="top" style="background:#f5f2ea;border-radius:10px;padding:14px;text-align:center;">
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a88656;">Fit score</div>
        <div style="font-family:Georgia,serif;font-size:44px;font-weight:600;color:${tone};line-height:1;">${v.fit_score}</div>
        <div style="font-size:11px;color:#6b7280;">of 100 · ${esc(v.confidence)} confidence</div>
      </td>
      <td width="4%"></td>
      <td width="62%" valign="top" style="background:#0b1530;border-radius:10px;padding:14px;color:#ffffff;">
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ebb43b;">Recommended</div>
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;line-height:1.2;margin-top:4px;">${esc(v.recommended_product)}</div>
        <div style="color:#e2c981;font-size:14px;margin-top:2px;">${esc(v.suggested_range)}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:6px;line-height:1.4;">${esc(v.recommended_structure)}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:6px 28px 0 28px;font-size:14px;line-height:1.6;color:#1f2937;">${esc(v.summary)}</td></tr>
  <tr><td style="padding:18px 28px 0 28px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a88656;margin-bottom:8px;">Key takeaways</div>
    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5;color:#1f2937;">${li(v.key_takeaways)}</ul>
  </td></tr>
  ${flags.length ? `<tr><td style="padding:18px 28px 0 28px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a88656;margin-bottom:8px;">Risk flags</div>
    ${flags.map((f) => `<div style="border:1px solid ${f.severity === "high" ? "#fecaca" : f.severity === "medium" ? "#fde68a" : "#e9e4d6"};background:${f.severity === "high" ? "#fef2f2" : f.severity === "medium" ? "#fffbeb" : "#f5f2ea"};border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px;line-height:1.45;"><strong>${esc(f.title)}</strong> <span style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">${esc(f.severity)}</span><br>${esc(f.description)}</div>`).join("")}
  </td></tr>` : ""}
  <tr><td style="padding:18px 28px 0 28px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a88656;margin-bottom:8px;">First-call talking points</div>
    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5;color:#1f2937;font-family:Georgia,serif;font-style:italic;">${li(v.talking_points)}</ul>
  </td></tr>
  <tr><td align="center" style="padding:26px 28px;">
    <a href="${esc(url)}" style="display:inline-block;background:#c9a84c;color:#0b1530;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.5px;padding:13px 26px;border-radius:8px;">Open the full deal memo →</a>
    <div style="font-size:11px;color:#6b7280;margin-top:10px;">Cases, financial snapshot, sourced findings, next steps, and the audio briefing.</div>
  </td></tr>
  <tr><td style="padding:0 28px 22px 28px;font-size:11px;line-height:1.5;color:#6b7280;border-top:1px solid #e9e4d6;">
    <div style="padding-top:14px;">${esc(memo.disclaimer)}</div>
    ${stats ? `<div style="margin-top:6px;">Committee ran ${Math.round(stats.duration_ms / 1000)}s · ${stats.searches} web searches.</div>` : ""}
    ${intake.notes ? `<div style="margin-top:6px;">Intake notes: ${esc(intake.notes)}</div>` : ""}
    <div style="margin-top:12px;color:#1b2d63;">MintIQ · From Miami with love. 🤍 <span style="color:#9aa0ad;">Built by Automate305</span></div>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `MintIQ deal memo · ${b.legal_name}`,
    v.headline,
    `Fit score ${v.fit_score}/100 (${v.confidence} confidence) · ${v.recommended_product} · ${v.suggested_range}`,
    ``, v.summary, ``,
    `Key takeaways:`, ...v.key_takeaways.map((t) => `- ${t}`), ``,
    flags.length ? `Risk flags:` : "", ...flags.map((f) => `- [${f.severity}] ${f.title}: ${f.description}`), ``,
    `Full memo: ${url}`, ``, memo.disclaimer,
  ].join("\n");
  return { subject, html, text };
}

export async function sendMemoEmail(to: string, input: MemoEmailInput): Promise<{ sent: boolean; reason?: string }> {
  if (!isMailConfigured()) return { sent: false, reason: "SMTP not configured (MINTIQ_SMTP_USER / MINTIQ_SMTP_PASS)" };
  const { subject, html, text } = renderMemoEmail(input);
  await transport().sendMail({ from: cfg().from, to, subject, html, text });
  return { sent: true };
}
