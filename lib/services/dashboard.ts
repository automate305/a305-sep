import "server-only";

import { createClient } from "@supabase/supabase-js";

import { isUsableEnvironmentValue } from "@/lib/services/smtp.js";

export type DashboardBrandMetrics = {
  active: number;
  bounced: number;
  held: number;
  queued: number;
  replied: number;
  sentToday: number;
};

export type DashboardQueueItem = {
  bodyPreview: string;
  campaign: string;
  company: string;
  email: string;
  id: string;
  initials: string;
  name: string;
  nextSendDate: string | null;
  sequenceName: string;
  step: number;
  subject: string;
};

export type DashboardHoldItem = {
  campaign: string;
  company: string;
  email: string;
  heldAt: string | null;
  holdReason: string;
  id: string;
  initials: string;
  name: string;
  sequenceName: string;
  step: number;
};

export type DashboardActivity = {
  campaign: string;
  contactName: string;
  detail: string;
  id: string;
  occurredAt: string;
  status: "failed" | "sent";
  subject: string;
};

export type DashboardReply = {
  campaign: string;
  company: string;
  completedAt: string | null;
  email: string;
  id: string;
  name: string;
  sequenceName: string;
};

export type DashboardPipelineRow = {
  active: number;
  bounced: number;
  campaign: string;
  completed: number;
  replied: number;
  sequence: string;
  total: number;
  unsubscribed: number;
};

export type DashboardSequenceStep = {
  bodyText: string;
  delayDays: number;
  id: string;
  step: number;
  subject: string;
};

export type DashboardSequence = {
  active: boolean;
  campaign: string;
  description: string;
  id: string;
  name: string;
  steps: DashboardSequenceStep[];
};

export type DashboardContact = {
  area: string | null;
  city: string | null;
  company: string | null;
  email: string;
  firstName: string | null;
  id: string;
  lastActivity: string | null;
  lastName: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  personalizedParagraph: string | null;
  source: string | null;
  title: string | null;
  websiteObservation: string | null;
};

export type DashboardHealthComponents = {
  bounceRate: number | null;
  complaintRate: number | null;
  inboxPlacement: number | null;
  postmaster: number | null;
  replyRate: number | null;
};

export type DashboardSender = {
  active: boolean;
  campaign: string;
  dailyLimit: number;
  email: string;
  healthComponents: DashboardHealthComponents;
  healthScore: number | null;
  name: string;
  projectedGraduation: string | null;
  provider: "Google Workspace" | "Hostinger" | "SMTP";
  sendMode: "live" | "paused" | "seed-only";
  sendsToday: number;
  warmed: boolean;
  warmupDay: number | null;
  warmupStartedAt: string | null;
};

export type DashboardData = {
  activities: DashboardActivity[];
  aiSpend: {
    budget: number;
    configured: boolean;
    remaining: number;
    spent: number;
  };
  brandMetrics: Record<"aesthetic" | "all" | "hvac", DashboardBrandMetrics>;
  configured: boolean;
  contactCount: number;
  errorMessage: string | null;
  generatedAt: string;
  holdQueue: DashboardHoldItem[];
  metrics: {
    activeEnrollments: number;
    bounced: number;
    completionRate: number;
    dueToday: number;
    failedToday: number;
    held: number;
    repliesThisMonth: number;
    replyRate: number;
    senderCapacityRemaining: number;
    senderDailyLimit: number;
    sentThisMonth: number;
    sentToday: number;
    totalEnrollments: number;
  };
  pipeline: DashboardPipelineRow[];
  queue: DashboardQueueItem[];
  replies: DashboardReply[];
  senders: DashboardSender[];
  sequences: DashboardSequence[];
};

export async function getContactsData(): Promise<DashboardContact[]> {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";
  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) return [];

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase
    .from("contacts")
    .select("id,email,first_name,last_name,company,practice_name,title,phone,city,area,linkedin_url,source,personalized_paragraph,website_observation,created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("Contacts data load failed", error);
    return [];
  }
  return (data || []).map((contact) => ({
    area: contact.area || null,
    city: contact.city || null,
    company: contact.company || contact.practice_name || null,
    email: contact.email,
    firstName: contact.first_name || null,
    id: contact.id,
    lastActivity: contact.created_at || null,
    lastName: contact.last_name || null,
    linkedinUrl: contact.linkedin_url || null,
    phone: contact.phone || null,
    personalizedParagraph: contact.personalized_paragraph || null,
    source: contact.source || null,
    title: contact.title || null,
    websiteObservation: contact.website_observation || null,
  }));
}

type ContactRelation = {
  company: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  practice_name: string | null;
};

type SequenceRelation = { campaign?: string | null; name: string };
type SenderRelation = { campaign?: string | null; email: string; name: string };

type RawQueueItem = {
  area: string | null;
  body_text: string | null;
  campaign: string | null;
  company: string | null;
  email: string;
  enrollment_id: string;
  first_name: string | null;
  last_name: string | null;
  next_send_date?: string | null;
  pain_point: string | null;
  personalized_line: string | null;
  personalized_paragraph: string | null;
  practice_name: string | null;
  sequence_name: string;
  step: number;
  subject: string | null;
  website_observation: string | null;
};

type RawHoldItem = {
  contact: ContactRelation | ContactRelation[] | null;
  current_step: number;
  held_at?: string | null;
  hold_reason?: string | null;
  id: string;
  sequence: SequenceRelation | SequenceRelation[] | null;
};

type RawActivity = {
  contact: ContactRelation | ContactRelation[] | null;
  error_message: string | null;
  id: string;
  sender: SenderRelation | SenderRelation[] | null;
  sent_at: string;
  status: string;
  subject: string | null;
};

type RawReply = {
  completed_at: string | null;
  contact: ContactRelation | ContactRelation[] | null;
  id: string;
  sequence: SequenceRelation | SequenceRelation[] | null;
};

type RawPipelineRow = {
  active: number | string | null;
  bounced: number | string | null;
  campaign: string | null;
  completed: number | string | null;
  replied: number | string | null;
  sequence: string;
  total: number | string | null;
  unsubscribed: number | string | null;
};

type RawSequenceStep = {
  body_text: string;
  delay_days: number;
  id: string;
  step: number;
  subject: string;
};

type RawSequence = {
  active: boolean;
  campaign: string;
  description: string | null;
  id: string;
  name: string;
  templates: RawSequenceStep[] | null;
};

type RawSender = {
  active: boolean;
  bounce_score?: number | null;
  campaign: string | null;
  complaint_score?: number | null;
  daily_limit: number;
  email: string;
  health_score?: number | null;
  host?: string | null;
  inbox_placement_score?: number | null;
  name: string;
  postmaster_score?: number | null;
  reply_score?: number | null;
  sends_today: number;
  warmed: boolean;
  warmup_started_at?: string | null;
};

type RawSentMetric = {
  sender: Pick<SenderRelation, "campaign"> | Array<Pick<SenderRelation, "campaign">> | null;
};

function emptyBrandMetrics(): DashboardBrandMetrics {
  return { active: 0, bounced: 0, held: 0, queued: 0, replied: 0, sentToday: 0 };
}

function getAiBudget(): number {
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD || 50);
  return Number.isFinite(budget) && budget >= 0 ? budget : 50;
}

function createEmptyDashboardData(errorMessage: string | null): DashboardData {
  const budget = getAiBudget();
  return {
    activities: [],
    aiSpend: { budget, configured: false, remaining: budget, spent: 0 },
    brandMetrics: {
      aesthetic: emptyBrandMetrics(),
      all: emptyBrandMetrics(),
      hvac: emptyBrandMetrics(),
    },
    configured: false,
    contactCount: 0,
    errorMessage,
    generatedAt: new Date().toISOString(),
    holdQueue: [],
    metrics: {
      activeEnrollments: 0,
      bounced: 0,
      completionRate: 0,
      dueToday: 0,
      failedToday: 0,
      held: 0,
      repliesThisMonth: 0,
      replyRate: 0,
      senderCapacityRemaining: 0,
      senderDailyLimit: 0,
      sentThisMonth: 0,
      sentToday: 0,
      totalEnrollments: 0,
    },
    pipeline: [],
    queue: [],
    replies: [],
    senders: [],
    sequences: [],
  };
}

function getSingleRelation<T>(relation: T | T[] | null): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function getDisplayName(contact: ContactRelation | null): string {
  if (!contact) return "Unknown contact";
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
  return fullName || contact.email;
}

function getCompanyName(contact: ContactRelation | null): string {
  return contact?.company || contact?.practice_name || "Company not provided";
}

function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "?";
}

function previewTemplate(template: string | null, item: RawQueueItem): string {
  const company = item.company || item.practice_name || "your company";
  return (template || "No message body is configured for this step.")
    .replace(/{{first_name}}/g, item.first_name || "there")
    .replace(/{{last_name}}/g, item.last_name || "")
    .replace(/{{practice_name}}/g, item.practice_name || "your practice")
    .replace(/{{company}}/g, company)
    .replace(/{{area}}/g, item.area || "your area")
    .replace(/{{pain_point}}/g, item.pain_point || "your current workflow")
    .replace(/{{personalized_line}}/g, item.personalized_line || "")
    .replace(/{{personalized_paragraph}}/g, item.personalized_paragraph || "")
    .replace(/{{website_observation}}/g, item.website_observation || "")
    .replace(/{{sender_name}}/g, "[selected sender]")
    .replace(/{{signature}}/g, "[selected sender signature]")
    .replace(/{{[^}]+}}/g, "[personalized field]");
}

function numberValue(value: number | string | null | undefined): number {
  return Number(value || 0);
}

function getProvider(host: string | null | undefined): DashboardSender["provider"] {
  if (host?.includes("gmail")) return "Google Workspace";
  if (host?.includes("hostinger")) return "Hostinger";
  return "SMTP";
}

function getSendMode(sender: RawSender): DashboardSender["sendMode"] {
  if (sender.active && sender.warmed) return "live";
  if (!sender.warmed) return "seed-only";
  return "paused";
}

function getWarmupDetails(startedAt: string | null | undefined, warmed: boolean) {
  if (!startedAt) return { projectedGraduation: null, warmupDay: warmed ? 21 : null };
  const startDate = new Date(startedAt);
  const elapsedMilliseconds = Math.max(Date.now() - startDate.getTime(), 0);
  const warmupDay = Math.min(Math.floor(elapsedMilliseconds / 86_400_000) + 1, 21);
  const graduationDate = new Date(startDate);
  graduationDate.setUTCDate(graduationDate.getUTCDate() + 21);
  return {
    projectedGraduation: graduationDate.toISOString(),
    warmupDay: warmed ? Math.max(warmupDay, 21) : warmupDay,
  };
}

function getDayAndMonthStarts(now: Date) {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateParts.find((datePart) => datePart.type === type)?.value || "";
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(now).find((datePart) => datePart.type === "timeZoneName")?.value || "GMT-5";
  const offsetMatch = offsetName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = `${offsetMatch?.[1] || "-"}${(offsetMatch?.[2] || "5").padStart(2, "0")}:${offsetMatch?.[3] || "00"}`;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return {
    dayStart: `${year}-${month}-${day}T00:00:00${offset}`,
    monthStart: `${year}-${month}-01T00:00:00${offset}`,
  };
}

function addMetric(
  metrics: DashboardData["brandMetrics"],
  campaign: string,
  key: keyof DashboardBrandMetrics,
  amount = 1,
) {
  metrics.all[key] += amount;
  if (campaign === "aesthetic" || campaign === "hvac") metrics[campaign][key] += amount;
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";
  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return createEmptyDashboardData(
      "Add usable SUPABASE_URL and SUPABASE_SERVICE_KEY values to load live operations.",
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const now = new Date();
  const { dayStart, monthStart } = getDayAndMonthStarts(now);

  try {
    const results = await Promise.all([
      supabase.from("pipeline_summary")
        .select("sequence,campaign,active,completed,replied,unsubscribed,bounced,total")
        .order("campaign").order("sequence"),
      supabase.from("sequences")
        .select("id,name,campaign,description,active,templates(id,step,subject,body_text,delay_days)")
        .order("campaign").order("name"),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase.from("todays_queue").select("*", { count: "exact" }).limit(50),
      supabase.from("enrollments")
        .select("*,contact:contacts(first_name,last_name,email,company,practice_name),sequence:sequences(name,campaign)")
        .eq("status", "held").limit(20),
      supabase.from("send_log")
        .select("id,status,subject,sent_at,error_message,contact:contacts(first_name,last_name,email,company,practice_name),sender:senders(name,email,campaign)")
        .in("status", ["sent", "failed"]).order("sent_at", { ascending: false }).limit(8),
      supabase.from("enrollments")
        .select("id,completed_at,contact:contacts(first_name,last_name,email,company,practice_name),sequence:sequences(name,campaign)")
        .eq("status", "replied").order("completed_at", { ascending: false }).limit(8),
      supabase.from("senders").select("*").order("campaign").order("email"),
      supabase.from("send_log").select("sender:senders(campaign)")
        .eq("status", "sent").gte("sent_at", dayStart),
      supabase.from("send_log").select("id", { count: "exact", head: true })
        .eq("status", "failed").gte("sent_at", dayStart),
      supabase.from("send_log").select("id", { count: "exact", head: true })
        .eq("status", "sent").gte("sent_at", monthStart),
      supabase.from("enrollments").select("id", { count: "exact", head: true })
        .eq("status", "replied").gte("completed_at", monthStart),
    ]);

    const [pipelineResult, sequenceResult, contactCountResult, queueResult, holdResult,
      activityResult, replyResult, senderResult,
      sentTodayResult, failedTodayResult, sentMonthResult, repliedMonthResult] = results;
    const queryErrors = results.map((result) => result.error).filter(Boolean);
    if (queryErrors.length > 0) {
      throw new Error(queryErrors.map((error) => error?.message).join("; "));
    }

    const pipelineRows = (pipelineResult.data || []) as unknown as RawPipelineRow[];
    const sequenceRows = (sequenceResult.data || []) as unknown as RawSequence[];
    const queueRows = (queueResult.data || []) as unknown as RawQueueItem[];
    const holdRows = (holdResult.data || []) as unknown as RawHoldItem[];
    const activityRows = (activityResult.data || []) as unknown as RawActivity[];
    const replyRows = (replyResult.data || []) as unknown as RawReply[];
    const senderRows = (senderResult.data || []) as unknown as RawSender[];
    const sentTodayRows = (sentTodayResult.data || []) as unknown as RawSentMetric[];

    const pipelineRowsBySequence = new Map(pipelineRows.map((row) => [row.sequence, row]));
    const pipeline: DashboardPipelineRow[] = sequenceRows.map((sequence) => {
      const row = pipelineRowsBySequence.get(sequence.name);
      return {
        active: numberValue(row?.active),
        bounced: numberValue(row?.bounced),
        campaign: sequence.campaign || "general",
        completed: numberValue(row?.completed),
        replied: numberValue(row?.replied),
        sequence: sequence.name,
        total: numberValue(row?.total),
        unsubscribed: numberValue(row?.unsubscribed),
      };
    });

    const sequences: DashboardSequence[] = sequenceRows.map((sequence) => ({
      active: sequence.active,
      campaign: sequence.campaign || "general",
      description: sequence.description || "",
      id: sequence.id,
      name: sequence.name,
      steps: (sequence.templates || [])
        .toSorted((left, right) => left.step - right.step)
        .map((step) => ({
          bodyText: step.body_text,
          delayDays: step.delay_days,
          id: step.id,
          step: step.step,
          subject: step.subject,
        })),
    }));

    const queue: DashboardQueueItem[] = queueRows.map((item) => {
      const contact: ContactRelation = {
        company: item.company, email: item.email, first_name: item.first_name,
        last_name: item.last_name, practice_name: item.practice_name,
      };
      const name = getDisplayName(contact);
      return {
        bodyPreview: previewTemplate(item.body_text, item),
        campaign: item.campaign || "general",
        company: getCompanyName(contact),
        email: item.email,
        id: item.enrollment_id,
        initials: getInitials(name),
        name,
        nextSendDate: item.next_send_date || null,
        sequenceName: item.sequence_name,
        step: item.step,
        subject: previewTemplate(item.subject, item),
      };
    });

    const holdQueue: DashboardHoldItem[] = holdRows.map((item) => {
      const contact = getSingleRelation(item.contact);
      const sequence = getSingleRelation(item.sequence);
      const name = getDisplayName(contact);
      return {
        campaign: sequence?.campaign || "general",
        company: getCompanyName(contact),
        email: contact?.email || "",
        heldAt: item.held_at || null,
        holdReason: item.hold_reason || "Manual review required",
        id: item.id,
        initials: getInitials(name),
        name,
        sequenceName: sequence?.name || "Unknown sequence",
        step: item.current_step,
      };
    });

    const activities: DashboardActivity[] = activityRows.map((item) => {
      const contact = getSingleRelation(item.contact);
      const sender = getSingleRelation(item.sender);
      return {
        campaign: sender?.campaign || "general",
        contactName: getDisplayName(contact),
        detail: item.status === "failed" ? item.error_message || "Delivery failed" :
          `Sent via ${sender?.email || "configured sender"}`,
        id: item.id,
        occurredAt: item.sent_at,
        status: item.status === "failed" ? "failed" : "sent",
        subject: item.subject || "Email sent",
      };
    });

    const replies: DashboardReply[] = replyRows.map((item) => {
      const contact = getSingleRelation(item.contact);
      const sequence = getSingleRelation(item.sequence);
      return {
        campaign: sequence?.campaign || "general",
        company: getCompanyName(contact),
        completedAt: item.completed_at,
        email: contact?.email || "",
        id: item.id,
        name: getDisplayName(contact),
        sequenceName: sequence?.name || "Unknown sequence",
      };
    });

    const senders: DashboardSender[] = senderRows.map((sender) => {
      const warmup = getWarmupDetails(sender.warmup_started_at, sender.warmed);
      return {
        active: sender.active,
        campaign: sender.campaign || "general",
        dailyLimit: sender.daily_limit,
        email: sender.email,
        healthComponents: {
          bounceRate: sender.bounce_score ?? null,
          complaintRate: sender.complaint_score ?? null,
          inboxPlacement: sender.inbox_placement_score ?? null,
          postmaster: sender.postmaster_score ?? null,
          replyRate: sender.reply_score ?? null,
        },
        healthScore: sender.health_score ?? null,
        name: sender.name,
        projectedGraduation: warmup.projectedGraduation,
        provider: getProvider(sender.host),
        sendMode: getSendMode(sender),
        sendsToday: sender.sends_today,
        warmed: sender.warmed,
        warmupDay: warmup.warmupDay,
        warmupStartedAt: sender.warmup_started_at || null,
      };
    });

    const brandMetrics: DashboardData["brandMetrics"] = {
      aesthetic: emptyBrandMetrics(), all: emptyBrandMetrics(), hvac: emptyBrandMetrics(),
    };
    for (const row of pipeline) {
      addMetric(brandMetrics, row.campaign, "active", row.active);
      addMetric(brandMetrics, row.campaign, "bounced", row.bounced);
      addMetric(brandMetrics, row.campaign, "replied", row.replied);
    }
    for (const item of queue) addMetric(brandMetrics, item.campaign, "queued");
    for (const item of holdQueue) addMetric(brandMetrics, item.campaign, "held");
    for (const item of sentTodayRows) {
      const sender = getSingleRelation(item.sender);
      addMetric(brandMetrics, sender?.campaign || "general", "sentToday");
    }

    const activeSenders = senders.filter((sender) => sender.active);
    const senderDailyLimit = activeSenders.reduce((total, sender) => total + sender.dailyLimit, 0);
    const senderCapacityRemaining = activeSenders.reduce(
      (total, sender) => total + Math.max(sender.dailyLimit - sender.sendsToday, 0), 0,
    );
    const totalEnrollments = pipeline.reduce((total, row) => total + row.total, 0);
    const completedEnrollments = pipeline.reduce(
      (total, row) => total + row.completed + row.replied, 0,
    );
    const sentThisMonth = sentMonthResult.count || 0;
    const repliesThisMonth = repliedMonthResult.count || 0;

    const aiBudget = getAiBudget();
    const aiUsageResult = await supabase.from("ai_usage").select("cost_usd")
      .gte("created_at", monthStart);
    const aiSpendConfigured = aiUsageResult.error === null;
    const aiSpent = aiSpendConfigured
      ? (aiUsageResult.data || []).reduce(
          (total, usage) => total + numberValue(usage.cost_usd as number | string | null), 0,
        )
      : 0;

    return {
      activities,
      aiSpend: {
        budget: aiBudget,
        configured: aiSpendConfigured,
        remaining: Math.max(aiBudget - aiSpent, 0),
        spent: aiSpent,
      },
      brandMetrics,
      configured: true,
      contactCount: contactCountResult.count || 0,
      errorMessage: null,
      generatedAt: now.toISOString(),
      holdQueue,
      metrics: {
        activeEnrollments: brandMetrics.all.active,
        bounced: brandMetrics.all.bounced,
        completionRate: totalEnrollments > 0
          ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0,
        dueToday: queueResult.count || queue.length,
        failedToday: failedTodayResult.count || 0,
        held: brandMetrics.all.held,
        repliesThisMonth,
        replyRate: sentThisMonth > 0
          ? Math.round((repliesThisMonth / sentThisMonth) * 100) : 0,
        senderCapacityRemaining,
        senderDailyLimit,
        sentThisMonth,
        sentToday: brandMetrics.all.sentToday,
        totalEnrollments,
      },
      pipeline,
      queue,
      replies,
      senders,
      sequences,
    };
  } catch (error) {
    console.error("Dashboard data load failed", error);
    const dashboardData = createEmptyDashboardData(
      "Live outreach data is temporarily unavailable. No sends were triggered.",
    );
    dashboardData.configured = true;
    return dashboardData;
  }
}
