import { createClient } from "@supabase/supabase-js";

import { createSmtpTransporter, isUsableEnvironmentValue, verifySmtpSender } from "./smtp.js";

const WARMUP_SENDER_EMAILS = ["matt@aestheticdevicepro.com", "tamiko@aestheticdevicepro.com"];

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

const TOTAL_WARMUP_DAYS = 21;

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

function dailyCap(day: number) {
  if (day <= 3) return 2;
  if (day <= 7) return 2;
  if (day <= 14) return 3;
  return 4;
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

async function hostingerSenders() {
  const supabase = client();
  if (!supabase) return { error: "Supabase is not configured.", senders: [] as WarmupSender[], supabase: null };
  const { data, error } = await supabase.from("senders").select("id,email,name,host,port,daily_limit,warmed,active,warmup_started_at")
    .in("email", WARMUP_SENDER_EMAILS).order("email");
  return { error: error?.message || null, senders: (data || []) as WarmupSender[], supabase };
}

export async function startHostingerWarmup(): Promise<WarmupResult> {
  if (recipients().length < 4) return { message: "Add four seed inboxes to WARMUP_SEED_RECIPIENTS before starting.", ok: false, sent: 0 };
  const { error, senders, supabase } = await hostingerSenders();
  if (error || !supabase) return { message: error || "Supabase is not configured.", ok: false, sent: 0 };
  if (senders.length !== WARMUP_SENDER_EMAILS.length) return { message: "Matt and Tamiko must both exist as Hostinger senders.", ok: false, sent: 0 };
  try {
    await Promise.all(senders.map((sender) => verifySmtpSender(sender)));
  } catch {
    return { message: "SMTP authentication failed. No warmup was started and no email was sent.", ok: false, sent: 0 };
  }
  const { error: updateError } = await supabase.from("senders").update({ active: true, daily_limit: 2, warmup_started_at: new Date().toISOString() })
    .in("email", WARMUP_SENDER_EMAILS).eq("warmed", false);
  if (updateError) return { message: `Unable to start warmup: ${updateError.message}`, ok: false, sent: 0 };
  return { message: "21-day warmup started. No email has been sent yet.", ok: true, sent: 0 };
}

export async function runHostingerWarmup(): Promise<WarmupResult> {
  const seedRecipients = recipients();
  if (seedRecipients.length < 4) return { message: "Four seed inboxes are required. No email was sent.", ok: false, sent: 0 };
  const { error, senders, supabase } = await hostingerSenders();
  if (error || !supabase) return { message: error || "Supabase is not configured.", ok: false, sent: 0 };
  const activeSenders = senders.filter((sender) => sender.active && !sender.warmed && sender.warmup_started_at);
  if (activeSenders.length !== WARMUP_SENDER_EMAILS.length) return { message: "Start Matt and Tamiko's warmup first. No email was sent.", ok: false, sent: 0 };

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
        await transporter.sendMail({
          from: `"${sender.name}" <${sender.email}>`,
          to: recipient,
          subject: "Quick mailbox setup check",
          text: `Hi,\n\nI’m confirming a new mailbox is delivering normally. No action is needed unless you’d like to reply.\n\nThanks,\n${sender.name}`,
        });
        transporter.close();
        const { error: logError } = await supabase.from("send_log").insert({ sender_id: sender.id, status: "warmup", step: 0, subject: "Internal mailbox setup check" });
        if (logError) throw logError;
        sent += 1;
      } catch (sendError) {
        return { message: `Warmup stopped after ${sent} send${sent === 1 ? "" : "s"}: ${sendError instanceof Error ? sendError.message : "SMTP send failed"}`, ok: false, progress, sent };
      }
    }
    await supabase.from("senders").update({ daily_limit: cap, sends_today: cap - remaining + remaining }).eq("id", sender.id);
    // Reaching day 21 only means the ramp is complete, never that `warmed`
    // gets flipped here — graduating a mailbox to real sends is a deliberate
    // operator action, not a side effect of this running on schedule.
    progress.push({ activeDay: day, email: sender.email, readyToGraduate: day >= TOTAL_WARMUP_DAYS });
  }
  return { message: sent ? `${sent} internal warmup message${sent === 1 ? "" : "s"} sent. No prospects or sequences were used.` : "Today's warmup cap was already reached. No email was sent.", ok: true, progress, sent };
}
