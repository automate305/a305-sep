// ============================================================
// QuoteMend dashboard · server-side data layer
//
// SERVER-ONLY. Reads Supabase with the service-role key; nothing in
// this file may be imported from a client component. The dashboard
// page passes plain serializable props down to the client UI.
//
// Read models used (all defined in supabase/schema.sql):
//   todays_queue       → the rescue queue (follow-ups due today)
//   pipeline_summary   → per-sequence enrollment counts
//   send_log           → autopilot activity (last 24h)
//   available_senders  → sender capacity today
// ============================================================

import "server-only";
import { createClient } from "@supabase/supabase-js";

// ── Types shared with the client component (plain data only) ──

export interface QueueItem {
  enrollmentId: string;
  contactId: string;
  name: string;
  initials: string;
  company: string;
  email: string;
  sequenceName: string;
  campaign: string;
  step: number;
  daysOverdue: number; // 0 = due today
  priority: "Hot" | "Warm" | "Watch";
  signal: string; // the personalization line we actually have on file
  accent: string;
  // Read-only preview of the real email that /api/send would send:
  previewSubject: string;
  previewBody: string;
}

export interface PipelineRow {
  sequence: string;
  campaign: string;
  active: number;
  completed: number;
  replied: number;
  total: number;
}

export interface ActivityItem {
  kind: "sent" | "replied" | "bounced" | "failed";
  title: string;
  detail: string;
  time: string;
}

export interface SenderInfo {
  name: string;
  email: string;
  campaign: string;
  sendsToday: number;
  dailyLimit: number;
}

export interface DashboardData {
  configured: boolean; // false → env not set; UI shows setup state
  queue: QueueItem[];
  pipeline: PipelineRow[];
  totals: { active: number; replied: number; completed: number; total: number };
  autopilot: {
    sentLast24h: number;
    repliesLast24h: number;
    bouncedLast24h: number;
    feed: ActivityItem[];
  };
  senders: SenderInfo[];
  recentWins: { name: string; sequence: string; when: string }[];
}

// ── Template merge (mirrors api/send.js mergeTemplate exactly) ──
// Used ONLY for a read-only preview of the outgoing email. Keep in
// sync with api/send.js — that file remains the source of truth for
// what actually gets sent.

interface MergeContact {
  first_name?: string | null;
  last_name?: string | null;
  practice_name?: string | null;
  company?: string | null;
  personalized_line?: string | null;
  personalized_paragraph?: string | null;
  pain_point?: string | null;
  area?: string | null;
  city?: string | null;
  website_observation?: string | null;
}

export function mergeTemplate(text: string, contact: MergeContact): string {
  const area = contact.area || contact.city || "South Florida";
  return (text || "")
    .replace(/\{\{first_name\}\}/g, contact.first_name || "there")
    .replace(/\{\{last_name\}\}/g, contact.last_name || "")
    .replace(/\{\{practice_name\}\}/g, contact.practice_name || "your practice")
    .replace(
      /\{\{company\}\}/g,
      contact.company || contact.practice_name || "your company"
    )
    .replace(/\{\{sender_name\}\}/g, "your sender")
    .replace(/\{\{signature\}\}/g, "your sender")
    .replace(
      /\{\{personalized_line\}\}/g,
      contact.personalized_line ||
        "I came across your company while looking at HVAC shops in the area."
    )
    .replace(
      /\{\{personalized_paragraph\}\}/g,
      contact.personalized_paragraph ||
        contact.personalized_line ||
        "I came across your company while looking at HVAC shops in the area."
    )
    .replace(/\{\{pain_point\}\}/g, contact.pain_point || "scheduling and dispatch")
    .replace(/\{\{area\}\}/g, area)
    .replace(
      /\{\{website_observation\}\}/g,
      contact.website_observation ||
        "There are a few quick wins that could help it convert more visitors into booked calls."
    );
}

// ── Priority derivation ───────────────────────────────────────
// Real, defensible ranking from the data we actually have:
//   Hot   → follow-up is overdue (next_send_date < today)
//   Warm  → due today, mid-sequence (step > 1)
//   Watch → due today, first touch (step 1)
export function derivePriority(
  daysOverdue: number,
  step: number
): QueueItem["priority"] {
  if (daysOverdue > 0) return "Hot";
  if (step > 1) return "Warm";
  return "Watch";
}

export function initialsOf(first?: string | null, last?: string | null): string {
  const a = (first || "").trim().charAt(0);
  const b = (last || "").trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}

const ACCENTS = ["coral", "violet", "blue", "sand"];

function daysBetween(from: string, to: Date): number {
  const d = new Date(`${from}T00:00:00Z`);
  const diff = Math.floor((to.getTime() - d.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

// ── Loader ────────────────────────────────────────────────────

const EMPTY: DashboardData = {
  configured: false,
  queue: [],
  pipeline: [],
  totals: { active: 0, replied: 0, completed: 0, total: 0 },
  autopilot: { sentLast24h: 0, repliesLast24h: 0, bouncedLast24h: 0, feed: [] },
  senders: [],
  recentWins: [],
};

export async function loadDashboardData(): Promise<DashboardData> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return EMPTY; // graceful no-env state

  const supabase = createClient(url, key);
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const [queueRes, pipelineRes, sendersRes, logRes, winsRes] =
    await Promise.all([
      supabase.from("todays_queue").select("*").limit(50),
      supabase.from("pipeline_summary").select("*"),
      supabase.from("available_senders").select("*"),
      supabase
        .from("send_log")
        .select("status, subject, sent_at, contacts(first_name,last_name,company,practice_name)")
        .gte("sent_at", since)
        .order("sent_at", { ascending: false })
        .limit(20),
      supabase
        .from("enrollments")
        .select("completed_at, contacts(first_name,last_name), sequences(name)")
        .eq("status", "replied")
        .order("enrolled_at", { ascending: false })
        .limit(5),
    ]);

  // Surface hard failures rather than rendering wrong numbers.
  const firstError =
    queueRes.error || pipelineRes.error || sendersRes.error || logRes.error;
  if (firstError) {
    throw new Error(`Dashboard query failed: ${firstError.message}`);
  }

  type QueueRow = {
    enrollment_id: string;
    contact_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    practice_name: string | null;
    company: string | null;
    step: number;
    sequence_name: string;
    campaign: string | null;
    subject: string | null;
    body_text: string | null;
    personalized_line: string | null;
    personalized_paragraph: string | null;
    pain_point: string | null;
    area: string | null;
    city: string | null;
    website_observation: string | null;
  };

  const queue: QueueItem[] = ((queueRes.data ?? []) as QueueRow[]).map(
    (row, i) => {
      // todays_queue only returns rows due today or earlier; the view does
      // not expose next_send_date, so overdue is derived best-effort as 0
      // (due today). Kept explicit so a later view change can improve it.
      const daysOverdue = 0;
      const step = row.step ?? 1;
      const name =
        [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email;
      return {
        enrollmentId: row.enrollment_id,
        contactId: row.contact_id,
        name,
        initials: initialsOf(row.first_name, row.last_name),
        company: row.company || row.practice_name || "—",
        email: row.email,
        sequenceName: row.sequence_name,
        campaign: row.campaign || "aesthetic",
        step,
        daysOverdue,
        priority: derivePriority(daysOverdue, step),
        signal:
          row.personalized_line ||
          row.pain_point ||
          `Step ${step} of "${row.sequence_name}" due today`,
        accent: ACCENTS[i % ACCENTS.length],
        previewSubject: mergeTemplate(row.subject || "", row),
        previewBody: mergeTemplate(row.body_text || "", row),
      };
    }
  );

  type PipelineDbRow = {
    sequence: string;
    campaign: string | null;
    active: number;
    completed: number;
    replied: number;
    total: number;
  };
  const pipeline: PipelineRow[] = ((pipelineRes.data ?? []) as PipelineDbRow[]).map(
    (r) => ({
      sequence: r.sequence,
      campaign: r.campaign || "aesthetic",
      active: r.active ?? 0,
      completed: r.completed ?? 0,
      replied: r.replied ?? 0,
      total: r.total ?? 0,
    })
  );

  const totals = pipeline.reduce(
    (acc, r) => ({
      active: acc.active + r.active,
      replied: acc.replied + r.replied,
      completed: acc.completed + r.completed,
      total: acc.total + r.total,
    }),
    { active: 0, replied: 0, completed: 0, total: 0 }
  );

  type LogRow = {
    status: string;
    subject: string | null;
    sent_at: string;
    contacts: {
      first_name: string | null;
      last_name: string | null;
      company: string | null;
      practice_name: string | null;
    } | null;
  };
  const log = (logRes.data ?? []) as unknown as LogRow[];
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });

  const feed: ActivityItem[] = log.slice(0, 8).map((l) => {
    const who =
      [l.contacts?.first_name, l.contacts?.last_name]
        .filter(Boolean)
        .join(" ") || "A contact";
    const where = l.contacts?.company || l.contacts?.practice_name || "";
    const kind = (
      ["sent", "replied", "bounced", "failed"].includes(l.status)
        ? l.status
        : "sent"
    ) as ActivityItem["kind"];
    return {
      kind,
      title:
        kind === "replied"
          ? `${who} replied`
          : kind === "sent"
            ? `Follow-up sent to ${who}`
            : `${who}: ${l.status}`,
      detail: [where, l.subject].filter(Boolean).join(" · ") || "—",
      time: fmtTime(l.sent_at),
    };
  });

  const sentLast24h = log.filter((l) => l.status === "sent").length;
  const repliesLast24h = log.filter((l) => l.status === "replied").length;
  const bouncedLast24h = log.filter((l) => l.status === "bounced").length;

  type SenderRow = {
    name: string;
    email: string;
    campaign: string | null;
    sends_today: number;
    daily_limit: number;
  };
  const senders: SenderInfo[] = ((sendersRes.data ?? []) as SenderRow[]).map(
    (s) => ({
      name: s.name,
      email: s.email,
      campaign: s.campaign || "aesthetic",
      sendsToday: s.sends_today ?? 0,
      dailyLimit: s.daily_limit ?? 0,
    })
  );

  type WinRow = {
    completed_at: string | null;
    contacts: { first_name: string | null; last_name: string | null } | null;
    sequences: { name: string | null } | null;
  };
  const recentWins = (((winsRes.data ?? []) as unknown as WinRow[]) || []).map(
    (w) => ({
      name:
        [w.contacts?.first_name, w.contacts?.last_name]
          .filter(Boolean)
          .join(" ") || "A contact",
      sequence: w.sequences?.name || "—",
      when: w.completed_at
        ? new Date(w.completed_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "recently",
    })
  );

  return {
    configured: true,
    queue,
    pipeline,
    totals,
    autopilot: { sentLast24h, repliesLast24h, bouncedLast24h, feed },
    senders,
    recentWins,
  };
}
