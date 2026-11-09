import { createClient } from "@supabase/supabase-js";

import { createSmtpTransporter, isUsableEnvironmentValue, verifySmtpSender } from "./smtp.js";

// No longer hardcoded — warmable senders are discovered from the DB:
// active=true, warmed=false, warmup_started_at IS NOT NULL.

type WarmupSender = {
  active: boolean;
  daily_limit: number;
  email: string;
  host: string;
  id: string;
  name: string;
  port: number;
  warmed: boolean;
  warmup_started_at: string | null;
};

export type WarmupSenderProgress = {
  activeDay: number;
  email: string;
  readyToGraduate: boolean;
};

export type WarmupResult = {
  message: string;
  ok: boolean;
  progress?: WarmupSenderProgress[];
  sent: number;
};

export const TOTAL_WARMUP_DAYS = 28;

// What the board shows. The day is the real sending-day count from
// activeWarmupDay, never calendar time since warmup_started_at, and the
// graduation date is an estimate that assumes one sending day per calendar day.
export function warmupProgress(
  activeDay: number | null,
  warmed: boolean,
  startedAt: string | null | undefined,
  now: Date = new Date(),
): { projectedGraduation: string | null; warmupDay: number | null } {
  if (warmed) return { projectedGraduation: null, warmupDay: TOTAL_WARMUP_DAYS };
  if (!startedAt || activeDay === null) return { projectedGraduation: null, warmupDay: null };
  const graduation = new Date(now);
  graduation.setUTCDate(graduation.getUTCDate() + Math.max(TOTAL_WARMUP_DAYS - activeDay, 0));
  return { projectedGraduation: graduation.toISOString(), warmupDay: activeDay };
}

// "YYYY-MM-DD" in America/New_York, the calendar day a send counts toward.
function easternDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit", month: "2-digit", timeZone: "America/New_York", year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function easternDayStart() {
  return `${easternDateKey(new Date())}T00:00:00-04:00`;
}

function recipients() {
  return String(process.env.WARMUP_SEED_RECIPIENTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export function describeSendError(error: unknown) {
  if (!(error instanceof Error)) return "SMTP send failed";
  const { code, command } = error as Error & { code?: string; command?: string };
  const detail = [code, command].filter(Boolean).join(" during ");
  return detail ? `${error.message}: ${detail}` : error.message;
}

function dailyCap(day: number) {
  if (day <= 3) return 2;
  if (day <= 7) return 2;
  if (day <= 14) return 3;
  return 4;
}

// The warmup message is internal mail to the operator's own seed inboxes.
// Identical subject and body on every send is the plainest repetition signal a
// receiving filter sees, so each send takes one of several short wordings.
//
// Copy rules hold for every variant: the subject is lowercase and three or four
// words, the body is sentence case with no em dashes, no links, and the message
// is signed with the sending mailbox's own name (Matt or Tamiko, never anyone
// else). Variants are picked by an integer, not at random, so consecutive sends
// never repeat a subject or a body and the choice is testable.
const WARMUP_SUBJECTS = [
  "mailbox setup check",
  "quick delivery check",
  "checking mailbox delivery",
  "new mailbox test",
  "confirming mail delivery",
  "mailbox delivery test",
  "quick mailbox setup check",
] as const;

const WARMUP_GREETINGS = ["Hi,", "Hello,", "Hey,"] as const;

const WARMUP_BODIES = [
  "I’m confirming a new mailbox is delivering normally. No action is needed unless you’d like to reply.",
  "This is a quick check that mail from this new address is arriving as expected. Feel free to reply if it reached you.",
  "I’m testing delivery from a newly set up mailbox. If this reached you, a short reply is welcome. Otherwise no action is needed.",
  "Just making sure messages from this new mailbox are getting through. A quick reply is welcome if you see this.",
  "I’m checking that this mailbox is set up correctly and mail is landing where it should. Nothing is needed from you.",
] as const;

const WARMUP_CLOSINGS = ["Thanks,", "Thank you,", "Best regards,", "Best,"] as const;

export function warmupMessage(senderName: string, variant: number): { subject: string; text: string } {
  const index = Math.abs(Math.trunc(variant));
  const subject = WARMUP_SUBJECTS[index % WARMUP_SUBJECTS.length];
  const greeting = WARMUP_GREETINGS[index % WARMUP_GREETINGS.length];
  const body = WARMUP_BODIES[index % WARMUP_BODIES.length];
  const closing = WARMUP_CLOSINGS[(index + 1) % WARMUP_CLOSINGS.length];
  return { subject, text: `${greeting}\n\n${body}\n\n${closing}\n${senderName}` };
}

// Day N of warmup means "the Nth distinct calendar day this mailbox has
// actually sent on" — not calendar time since warmup_started_at. A mailbox
// silent for two weeks mid-ramp does not arrive back at a high cap just
// because the calendar moved; it resumes at the same rung it left off on.
// warmup_started_at itself is never read here and never written by this
// function — only startHostingerWarmup sets it, once, per the non-negotiable
// that resetting it restarts the clock on mailboxes already days into warming.
export async function activeWarmupDay(
  supabase: NonNullable<ReturnType<typeof client>>,
  senderId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const { data, error } = await supabase
    .from("send_log")
    .select("sent_at")
    .eq("sender_id", senderId)
    .eq("status", "warmup");
  if (error) throw error;

  const todayKey = easternDateKey(referenceDate);
  const priorActiveDays = new Set(
    ((data || []) as { sent_at: string }[])
      .map((row) => easternDateKey(new Date(row.sent_at)))
      .filter((key) => key !== todayKey),
  );

  return Math.min(priorActiveDays.size + 1, TOTAL_WARMUP_DAYS);
}

function client() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!isUsableEnvironmentValue(url) || !isUsableEnvironmentValue(key)) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function warmableSenders() {
  const supabase = client();
  if (!supabase) return { error: "Supabase is not configured.", senders: [] as WarmupSender[], supabase: null };
  const { data, error } = await supabase.from("senders").select("id,email,name,host,port,daily_limit,warmed,active,warmup_started_at")
    .eq("active", true).eq("warmed", false).not("warmup_started_at", "is", null).order("email");
  return { error: error?.message || null, senders: (data || []) as WarmupSender[], supabase };
}

export async function startWarmup(senderEmails: string[]): Promise<WarmupResult> {
  if (senderEmails.length === 0) return { message: "Provide at least one sender email to start warmup.", ok: false, sent: 0 };
  if (recipients().length < 4) return { message: "Add four seed inboxes to WARMUP_SEED_RECIPIENTS before starting.", ok: false, sent: 0 };
  const supabase = client();
  if (!supabase) return { message: "Supabase is not configured.", ok: false, sent: 0 };
  const { data, error } = await supabase.from("senders").select("id,email,name,host,port,daily_limit,warmed,active,warmup_started_at")
    .in("email", senderEmails).eq("warmed", false).is("warmup_started_at", null).order("email");
  if (error) return { message: error.message, ok: false, sent: 0 };
  const senders = (data || []) as WarmupSender[];
  if (senders.length !== senderEmails.length) {
    const found = senders.map((s) => s.email);
    const missing = senderEmails.filter((e) => !found.includes(e));
    return { message: `These senders are missing, already warmed, or already warming: ${missing.join(", ")}. Nothing was changed.`, ok: false, sent: 0 };
  }
  try {
    await Promise.all(senders.map((sender) => verifySmtpSender(sender)));
  } catch {
    return { message: "SMTP authentication failed. No warmup was started and no email was sent.", ok: false, sent: 0 };
  }
  const { error: updateError } = await supabase.from("senders").update({ active: true, daily_limit: 2, warmup_started_at: new Date().toISOString() })
    .in("email", senderEmails).eq("warmed", false).is("warmup_started_at", null);
  if (updateError) return { message: `Unable to start warmup: ${updateError.message}`, ok: false, sent: 0 };
  return { message: `${TOTAL_WARMUP_DAYS}-day warmup started for ${senderEmails.length} sender${senderEmails.length === 1 ? "" : "s"}. No email has been sent yet.`, ok: true, sent: 0 };
}

export async function startHostingerWarmup(): Promise<WarmupResult> {
  return startWarmup(["matt@aestheticdevicepro.com", "tamiko@aestheticdevicepro.com"]);
}

export async function startGoogleWorkspaceWarmup(): Promise<WarmupResult> {
  return startWarmup(["hello@automate305.com", "info@automate305.com"]);
}

export async function runWarmup(): Promise<WarmupResult> {
  const seedRecipients = recipients();
  if (seedRecipients.length < 4) return { message: "Four seed inboxes are required. No email was sent.", ok: false, sent: 0 };
  const { error, senders, supabase } = await warmableSenders();
  if (error || !supabase) return { message: error || "Supabase is not configured.", ok: false, sent: 0 };
  if (senders.length === 0) return { message: "No senders are in warmup. Start a warmup first. No email was sent.", ok: false, sent: 0 };
  const activeSenders = senders;

  let sent = 0;
  const progress: WarmupSenderProgress[] = [];
  for (const [senderIndex, sender] of activeSenders.entries()) {
    let day: number;
    try {
      day = await activeWarmupDay(supabase, sender.id);
    } catch (dayError) {
      return { message: `Unable to compute warmup progress: ${dayError instanceof Error ? dayError.message : "unknown error"}`, ok: false, progress, sent };
    }
    const cap = Math.min(dailyCap(day), seedRecipients.length);
    const { count, error: countError } = await supabase.from("send_log").select("id", { count: "exact", head: true })
      .eq("sender_id", sender.id).eq("status", "warmup").gte("sent_at", easternDayStart());
    if (countError) return { message: `Unable to check today's warmup activity: ${countError.message}`, ok: false, progress, sent };
    const remaining = Math.max(cap - (count || 0), 0);
    for (let offset = 0; offset < remaining; offset += 1) {
      const recipient = seedRecipients[(day + senderIndex + (count || 0) + offset - 1) % seedRecipients.length];
      try {
        const transporter = createSmtpTransporter(sender);
        // Consecutive sends in a run differ by one, so subject and body never
        // repeat back to back; the day and sender offsets keep a mailbox from
        // sending the same wording on consecutive days.
        const variant = Math.floor(Date.now() / 86_400_000) * 11 + senderIndex * 5 + (count || 0) + offset;
        const message = warmupMessage(sender.name, variant);
        await transporter.sendMail({
          from: `"${sender.name}" <${sender.email}>`,
          to: recipient,
          subject: message.subject,
          text: message.text,
        });
        transporter.close();
        const { error: logError } = await supabase.from("send_log").insert({ sender_id: sender.id, status: "warmup", step: 0, subject: "Internal mailbox setup check" });
        if (logError) throw logError;
        sent += 1;
      } catch (sendError) {
        return { message: `Warmup stopped after ${sent} send${sent === 1 ? "" : "s"} (${describeSendError(sendError)}). Check the mailbox's Sent folder before retrying.`, ok: false, progress, sent };
      }
    }
    await supabase.from("senders").update({ daily_limit: cap, sends_today: cap - remaining + remaining }).eq("id", sender.id);
    progress.push({ activeDay: day, email: sender.email, readyToGraduate: day >= TOTAL_WARMUP_DAYS });
  }
  return { message: sent ? `${sent} internal warmup message${sent === 1 ? "" : "s"} sent. No prospects or sequences were used.` : "Today's warmup cap was already reached. No email was sent.", ok: true, progress, sent };
}

export async function runHostingerWarmup(): Promise<WarmupResult> {
  return runWarmup();
}
