"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearDashboardSession,
  dashboardKeyIsValid,
  hasDashboardAccess,
  setDashboardSession,
} from "@/lib/services/dashboard-auth";
import {
  getSmtpPasswordEnvironmentVariable,
  getSmtpTransportSettings,
  getSmtpVerificationError,
  isUsableEnvironmentValue,
  verifySmtpSender,
} from "@/lib/services/smtp.js";
import { parseContactCsv } from "@/lib/utils/contact-import.js";
import {
  SUPPRESSION_SOURCES,
  parseSuppressionCsv,
  reinstateContact,
  suppressContact,
  toSuppressionCsv,
} from "@/lib/services/suppression.js";
import { runHostingerWarmup, startHostingerWarmup, type WarmupResult } from "@/lib/services/warmup";
import {
  DOMAIN_AUTH_BY_DOMAIN,
  checkDomainAuthentication,
  sendingDomainsFromSenders,
} from "@/lib/services/domain-auth.js";

export type DashboardUnlockState = { error: string };
export type HoldReviewResult = { message: string; ok: boolean };
export type ContactImportState = {
  details?: {
    duplicates: number;
    enrolled: number;
    invalid: number;
    suppressed: number;
  };
  message: string;
  status: "error" | "idle" | "success";
};
export type ContactEnrichmentState = { message: string; status: "error" | "idle" | "success" };
export type DomainCheckStatus = "fail" | "pass" | "unknown";
export type DomainCheckEntry = {
  check: string;
  checkedAt: string;
  detail: string;
  observed: string[];
  queried: string[];
  status: DomainCheckStatus;
  warnings: string[];
};
export type DomainAuthenticationReport = {
  checkedAt: string;
  configured: boolean;
  domain: string;
  overall: DomainCheckStatus;
  provider: string | null;
  results: Record<"blocklist" | "dkim" | "dmarc" | "mx" | "spf", DomainCheckEntry>;
};
export type DomainAuthenticationResult = {
  domains: DomainAuthenticationReport[];
  message: string;
  ok: boolean;
};
export type SuppressionActionState = {
  csv?: string;
  message: string;
  status: "error" | "idle" | "success";
};
export type SequenceActionState = {
  message: string;
  status: "error" | "idle" | "success";
};
export type SmtpReadinessResult = {
  message: string;
  ready: boolean;
  senders: Array<{
    email: string;
    error: string | null;
    provider: string;
    status: "ready" | "unavailable";
  }>;
};
export type { WarmupResult };

const enrollmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sequenceNamePattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const allowedCampaigns = new Set(["aesthetic", "hvac"]);

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || "";
  if (!isUsableEnvironmentValue(supabaseUrl) || !isUsableEnvironmentValue(supabaseServiceKey)) {
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function unlockDashboard(
  _previousState: DashboardUnlockState,
  formData: FormData,
): Promise<DashboardUnlockState> {
  const providedKey = String(formData.get("dashboardKey") || "");
  if (!dashboardKeyIsValid(providedKey)) {
    return { error: "That dashboard key is not valid." };
  }

  await setDashboardSession();
  redirect("/");
}

export async function lockDashboard(): Promise<void> {
  await clearDashboardSession();
  redirect("/");
}

export async function runSmtpReadinessCheck(): Promise<SmtpReadinessResult> {
  if (!(await hasDashboardAccess())) {
    return { message: "Dashboard session expired. Unlock it again.", ready: false, senders: [] };
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", ready: false, senders: [] };

  const { data: activeSenders, error } = await supabase
    .from("senders")
    .select("email,name,campaign,host,port,daily_limit,sends_today,warmed,active")
    .eq("active", true)
    .gt("daily_limit", 0)
    .order("campaign")
    .order("email");
  if (error) return { message: "Unable to load active mailboxes.", ready: false, senders: [] };

  const senders = await Promise.all((activeSenders || []).map(async (sender) => {
    const passwordName = getSmtpPasswordEnvironmentVariable(sender.email);
    const provider = getSmtpTransportSettings(sender).provider;
    if (!isUsableEnvironmentValue(process.env[passwordName])) {
      return { email: sender.email, error: `Missing ${passwordName}`, provider, status: "unavailable" as const };
    }
    try {
      await verifySmtpSender(sender);
      return { email: sender.email, error: null, provider, status: "ready" as const };
    } catch (verificationError) {
      return { email: sender.email, error: getSmtpVerificationError(verificationError).message, provider, status: "unavailable" as const };
    }
  }));
  const ready = senders.length > 0 && senders.every((sender) => sender.status === "ready");
  return {
    message: ready ? "SMTP authenticated. No email was sent." : "SMTP is not ready. No email was sent.",
    ready,
    senders,
  };
}

// Read-only. Every row it returns is a DNS lookup made during this call,
// stamped with when it ran. It writes nothing to DNS or to Supabase.
export async function runDomainAuthenticationCheck(): Promise<DomainAuthenticationResult> {
  if (!(await hasDashboardAccess())) {
    return { domains: [], message: "Dashboard session expired. Unlock it again.", ok: false };
  }

  // Check every domain an active mailbox sends from, so a third sending
  // domain added later can never be silently missing from this panel. The
  // configured domains are always included, even with no active sender.
  const supabase = getSupabaseAdminClient();
  let senderDomains: string[] = [];
  if (supabase) {
    const { data } = await supabase.from("senders").select("email").eq("active", true);
    senderDomains = sendingDomainsFromSenders(data || []);
  }
  const domains = [...new Set([...senderDomains, ...Object.keys(DOMAIN_AUTH_BY_DOMAIN)])].sort();

  const reports = await Promise.all(domains.map((domain) => checkDomainAuthentication(domain)));
  const failing = reports.filter((report) => report.overall === "fail").length;
  const unknown = reports.filter((report) => report.overall === "unknown").length;

  return {
    domains: reports as DomainAuthenticationReport[],
    message: failing > 0
      ? `${failing} of ${reports.length} domains have a failing check. No DNS was changed.`
      : unknown > 0
        ? `${unknown} of ${reports.length} domains could not be fully checked. No DNS was changed.`
        : `All ${reports.length} domains authenticate. No DNS was changed.`,
    ok: failing === 0 && unknown === 0,
  };
}

export async function startWarmup(): Promise<WarmupResult> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", ok: false, sent: 0 };
  const result = await startHostingerWarmup();
  if (result.ok) revalidatePath("/");
  return result;
}

export async function runWarmup(): Promise<WarmupResult> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", ok: false, sent: 0 };
  const result = await runHostingerWarmup();
  if (result.ok) revalidatePath("/");
  return result;
}

export async function reviewHeldMessage(
  enrollmentId: string,
  decision: "approve" | "skip",
): Promise<HoldReviewResult> {
  if (!(await hasDashboardAccess())) {
    return { message: "Dashboard session expired. Unlock it again.", ok: false };
  }
  if (!enrollmentIdPattern.test(enrollmentId) || !["approve", "skip"].includes(decision)) {
    return { message: "Invalid hold review request.", ok: false };
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { message: "Supabase is not configured.", ok: false };
  }
  const nextStatus = decision === "approve" ? "active" : "paused";
  const nextSendDate = getEasternDate();
  const { data, error } = await supabase
    .from("enrollments")
    .update({
      next_send_date: nextSendDate,
      reviewed_at: new Date().toISOString(),
      reviewed_by: "dashboard",
      status: nextStatus,
    })
    .eq("id", enrollmentId)
    .eq("status", "held")
    .select("id")
    .maybeSingle();

  if (error) return { message: `Review failed: ${error.message}`, ok: false };
  if (!data) return { message: "This hold was already reviewed.", ok: false };

  revalidatePath("/");
  return {
    message: decision === "approve" ? "Approved for the next send run." : "Skipped and paused.",
    ok: true,
  };
}

export async function importContactsAndEnroll(
  _previousState: ContactImportState,
  formData: FormData,
): Promise<ContactImportState> {
  if (!(await hasDashboardAccess())) {
    return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  }

  const sequenceId = String(formData.get("sequenceId") || "");
  if (!enrollmentIdPattern.test(sequenceId)) {
    return { message: "Choose a valid sequence.", status: "error" };
  }

  const contactFile = formData.get("contactFile");
  let contactCsv = String(formData.get("contactsCsv") || "");
  if (contactFile instanceof File && contactFile.size > 0) {
    if (contactFile.size > 1_000_000) {
      return { message: "CSV files must be smaller than 1 MB.", status: "error" };
    }
    contactCsv = await contactFile.text();
  }

  const parsedImport = parseContactCsv(contactCsv);
  if (parsedImport.contacts.length === 0) {
    return {
      details: {
        duplicates: parsedImport.duplicateCount,
        enrolled: 0,
        invalid: parsedImport.errors.length,
        suppressed: 0,
      },
      message: parsedImport.errors[0] || "No valid contacts were found.",
      status: "error",
    };
  }

  const requestedStartDate = String(formData.get("startDate") || "");
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate)
    ? requestedStartDate
    : getEasternDate();
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };

  const { data: sequence, error: sequenceError } = await supabase
    .from("sequences")
    .select("id,name,active")
    .eq("id", sequenceId)
    .maybeSingle();
  if (sequenceError) {
    return { message: `Sequence lookup failed: ${sequenceError.message}`, status: "error" };
  }
  if (!sequence?.active) {
    return { message: "Choose an active sequence before enrolling contacts.", status: "error" };
  }

  const emails = parsedImport.contacts.map((contact) => contact.email);
  const { data: existingContacts, error: existingContactError } = await supabase
    .from("contacts")
    .select("id,email,unsubscribed,bounced")
    .in("email", emails);
  if (existingContactError) {
    return { message: `Contact lookup failed: ${existingContactError.message}`, status: "error" };
  }

  const existingEmails = new Set((existingContacts || []).map((contact) => contact.email));
  const newContacts = parsedImport.contacts.filter((contact) => !existingEmails.has(contact.email));
  if (newContacts.length > 0) {
    const { error: insertContactError } = await supabase.from("contacts").insert(newContacts);
    if (insertContactError) {
      return { message: `Contact import failed: ${insertContactError.message}`, status: "error" };
    }
  }

  const { data: importedContacts, error: importedContactError } = await supabase
    .from("contacts")
    .select("id,email,unsubscribed,bounced")
    .in("email", emails);
  if (importedContactError) {
    return { message: `Imported contact lookup failed: ${importedContactError.message}`, status: "error" };
  }

  const eligibleContacts = (importedContacts || []).filter(
    (contact) => !contact.unsubscribed && !contact.bounced,
  );
  const suppressedCount = (importedContacts || []).length - eligibleContacts.length;
  const eligibleContactIds = eligibleContacts.map((contact) => contact.id);
  let existingEnrollmentIds = new Set<string>();

  if (eligibleContactIds.length > 0) {
    const { data: existingEnrollments, error: existingEnrollmentError } = await supabase
      .from("enrollments")
      .select("contact_id")
      .eq("sequence_id", sequenceId)
      .in("contact_id", eligibleContactIds);
    if (existingEnrollmentError) {
      return { message: `Enrollment lookup failed: ${existingEnrollmentError.message}`, status: "error" };
    }
    existingEnrollmentIds = new Set(
      (existingEnrollments || []).map((enrollment) => enrollment.contact_id),
    );
  }

  const heldAt = new Date().toISOString();
  const newEnrollments = eligibleContacts
    .filter((contact) => !existingEnrollmentIds.has(contact.id))
    .map((contact) => ({
      contact_id: contact.id,
      current_step: 1,
      held_at: heldAt,
      hold_reason: "First-touch approval required",
      next_send_date: startDate,
      sequence_id: sequenceId,
      status: "held",
    }));

  if (newEnrollments.length > 0) {
    const { error: insertEnrollmentError } = await supabase
      .from("enrollments")
      .insert(newEnrollments);
    if (insertEnrollmentError) {
      return { message: `Enrollment failed: ${insertEnrollmentError.message}`, status: "error" };
    }
  }

  revalidatePath("/");
  const invalidCount = parsedImport.errors.length;
  const skippedEnrollmentCount = existingEnrollmentIds.size;
  return {
    details: {
      duplicates: parsedImport.duplicateCount + skippedEnrollmentCount,
      enrolled: newEnrollments.length,
      invalid: invalidCount,
      suppressed: suppressedCount,
    },
    message: `${newEnrollments.length} contact${newEnrollments.length === 1 ? "" : "s"} added to ${sequence.name} and held for approval. No email was sent.`,
    status: "success",
  };
}

export async function importContacts(
  _previousState: ContactImportState,
  formData: FormData,
): Promise<ContactImportState> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  const contactFile = formData.get("contactFile");
  let contactCsv = String(formData.get("contactsCsv") || "");
  if (contactFile instanceof File && contactFile.size > 0) {
    if (contactFile.size > 1_000_000) return { message: "CSV files must be smaller than 1 MB.", status: "error" };
    contactCsv = await contactFile.text();
  }
  const parsedImport = parseContactCsv(contactCsv);
  if (parsedImport.contacts.length === 0) {
    return { details: { duplicates: parsedImport.duplicateCount, enrolled: 0, invalid: parsedImport.errors.length, suppressed: 0 }, message: parsedImport.errors[0] || "No valid contacts were found.", status: "error" };
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };
  const emails = parsedImport.contacts.map((contact) => contact.email);
  const { data: existingContacts, error: lookupError } = await supabase.from("contacts").select("email").in("email", emails);
  if (lookupError) return { message: `Contact lookup failed: ${lookupError.message}`, status: "error" };
  const existingEmails = new Set((existingContacts || []).map((contact) => contact.email));
  const newContacts = parsedImport.contacts.filter((contact) => !existingEmails.has(contact.email));
  if (newContacts.length > 0) {
    const { error } = await supabase.from("contacts").insert(newContacts);
    if (error) return { message: `Contact import failed: ${error.message}`, status: "error" };
  }
  revalidatePath("/contacts");
  revalidatePath("/");
  return {
    details: { duplicates: parsedImport.duplicateCount + existingEmails.size, enrolled: newContacts.length, invalid: parsedImport.errors.length, suppressed: 0 },
    message: `${newContacts.length} contact${newContacts.length === 1 ? "" : "s"} imported. They are not enrolled in a sequence and no email was sent.`,
    status: "success",
  };
}

// ── SUPPRESSION ─────────────────────────────────────────────────────────────
// Suppress one address by hand: a reply asking to stop, a complaint, a
// hard bounce someone spotted in the inbox. Goes through the same single
// transaction the public unsubscribe route uses.
export async function suppressContactByEmail(
  _previousState: SuppressionActionState,
  formData: FormData,
): Promise<SuppressionActionState> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  const email = String(formData.get("email") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || "Suppressed by an operator";
  if (!email.includes("@")) return { message: "Enter the email address to suppress.", status: "error" };

  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };

  try {
    const result = await suppressContact(supabase, {
      email,
      reason,
      scope: "global",
      source: SUPPRESSION_SOURCES.MANUAL,
    });
    revalidatePath("/contacts");
    revalidatePath("/");
    const stoodDown = Number(result?.enrollments_stood_down || 0);
    return {
      message: `${email} suppressed across both brands. ${stoodDown} active enrollment${stoodDown === 1 ? "" : "s"} stopped.`,
      status: "success",
    };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Suppression failed.", status: "error" };
  }
}

export async function reinstateContactByEmail(
  _previousState: SuppressionActionState,
  formData: FormData,
): Promise<SuppressionActionState> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  const email = String(formData.get("email") || "").trim();
  if (!email.includes("@")) return { message: "Enter the email address to reinstate.", status: "error" };

  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };

  try {
    await reinstateContact(supabase, { email, scope: "global" });
    revalidatePath("/contacts");
    revalidatePath("/");
    return {
      message: `${email} reinstated. No sequence was resumed; enroll them again deliberately.`,
      status: "success",
    };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Reinstate failed.", status: "error" };
  }
}

// Export and import are the round trip: a list exported here re-imports
// here without loss, and imports from another platform land the same way.
export async function exportSuppressions(): Promise<SuppressionActionState> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };

  const { data, error } = await supabase
    .from("suppressions")
    .select("value,match_type,scope,campaign,reason,source,created_at")
    .order("created_at", { ascending: false });
  if (error) return { message: `Suppression export failed: ${error.message}`, status: "error" };

  const rows = data || [];
  return {
    csv: toSuppressionCsv(rows),
    message: `${rows.length} suppression${rows.length === 1 ? "" : "s"} exported.`,
    status: "success",
  };
}

export async function importSuppressions(
  _previousState: SuppressionActionState,
  formData: FormData,
): Promise<SuppressionActionState> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  const suppressionFile = formData.get("suppressionFile");
  let suppressionCsv = String(formData.get("suppressionsCsv") || "");
  if (suppressionFile instanceof File && suppressionFile.size > 0) {
    if (suppressionFile.size > 1_000_000) return { message: "CSV files must be smaller than 1 MB.", status: "error" };
    suppressionCsv = await suppressionFile.text();
  }

  const parsed = parseSuppressionCsv(suppressionCsv);
  if (parsed.rows.length === 0) {
    return { message: parsed.errors[0] || "No valid suppressions were found.", status: "error" };
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };

  // Email rows go through suppress_contact so an imported opt-out also
  // stands down any sequence that address is sitting in. Domain rows have
  // no single contact to stand down, so they are inserted directly.
  let applied = 0;
  let standDowns = 0;
  for (const row of parsed.rows) {
    if (row.match_type === "email") {
      try {
        const result = await suppressContact(supabase, {
          campaign: row.campaign,
          email: row.value,
          reason: row.reason,
          scope: row.scope,
          source: row.source,
        });
        standDowns += Number(result?.enrollments_stood_down || 0);
        applied += 1;
      } catch {
        parsed.errors.push(`${row.value}: could not be suppressed`);
      }
    } else {
      const { error } = await supabase.from("suppressions").upsert(
        {
          campaign: row.campaign,
          match_type: row.match_type,
          reason: row.reason,
          scope: row.scope,
          source: row.source,
          value: row.value,
        },
        { ignoreDuplicates: true, onConflict: "value,match_type,campaign" },
      );
      if (error) parsed.errors.push(`${row.value}: ${error.message}`);
      else applied += 1;
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/");
  const skipped = parsed.errors.length;
  return {
    message:
      `${applied} suppression${applied === 1 ? "" : "s"} imported, ` +
      `${standDowns} active enrollment${standDowns === 1 ? "" : "s"} stopped` +
      (skipped > 0 ? `, ${skipped} row${skipped === 1 ? "" : "s"} skipped.` : "."),
    status: "success",
  };
}

export async function requestGetLeadsEnrichment(
  _previousState: ContactEnrichmentState,
  formData: FormData,
): Promise<ContactEnrichmentState> {
  if (!(await hasDashboardAccess())) return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  const contactIds = String(formData.get("contactIds") || "").split(",").filter((id) => enrollmentIdPattern.test(id));
  if (contactIds.length === 0 || contactIds.length > 100) return { message: "Choose between 1 and 100 contacts to enrich.", status: "error" };
  return {
    message: `Selected ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}. Export them for the Cowork GetLeads run; OUTBOX does not yet have a direct GetLeads API connection, so this safely avoids inventing enrichment data.`,
    status: "success",
  };
}

type SequenceStepInput = {
  bodyText: string;
  delayDays: number;
  step: number;
  subject: string;
};

function parseSequenceSteps(value: string): SequenceStepInput[] | null {
  try {
    const parsedValue = JSON.parse(value);
    if (!Array.isArray(parsedValue) || parsedValue.length < 1 || parsedValue.length > 10) return null;
    return parsedValue.map((step, stepIndex) => ({
      bodyText: String(step.bodyText || "").trim(),
      delayDays: Number(step.delayDays),
      step: stepIndex + 1,
      subject: String(step.subject || "").trim(),
    }));
  } catch {
    return null;
  }
}

export async function saveSequence(
  _previousState: SequenceActionState,
  formData: FormData,
): Promise<SequenceActionState> {
  if (!(await hasDashboardAccess())) {
    return { message: "Dashboard session expired. Unlock it again.", status: "error" };
  }

  const sequenceId = String(formData.get("sequenceId") || "");
  const name = String(formData.get("name") || "").trim().toLowerCase();
  const campaign = String(formData.get("campaign") || "");
  const description = String(formData.get("description") || "").trim();
  const active = formData.get("active") === "on";
  const steps = parseSequenceSteps(String(formData.get("steps") || ""));

  if (sequenceId && !enrollmentIdPattern.test(sequenceId)) {
    return { message: "The sequence identifier is invalid.", status: "error" };
  }
  if (!sequenceNamePattern.test(name) || name.length > 64) {
    return { message: "Use a lowercase sequence name such as hvac_followup.", status: "error" };
  }
  if (!allowedCampaigns.has(campaign)) {
    return { message: "Choose an available brand for sender routing.", status: "error" };
  }
  if (description.length > 400) {
    return { message: "Keep the sequence description under 400 characters.", status: "error" };
  }
  if (!steps) {
    return { message: "Add between 1 and 10 valid sequence steps.", status: "error" };
  }
  const invalidCopyStep = steps.find((step) => {
    const subjectWordCount = step.subject.split(/\s+/).filter(Boolean).length;
    return step.subject !== step.subject.toLowerCase() || subjectWordCount < 3 || subjectWordCount > 4 || step.bodyText.includes("—");
  });
  if (invalidCopyStep) {
    return { message: "Subjects must be 3-4 lowercase words, and email copy cannot contain an em dash.", status: "error" };
  }
  const invalidStep = steps.find((step) =>
    !step.subject || step.subject.length > 200 || !step.bodyText || step.bodyText.length > 10_000 ||
    !Number.isInteger(step.delayDays) || step.delayDays < 0 || step.delayDays > 90
  );
  if (invalidStep) {
    return { message: "Each step needs a subject, body, and a delay from 0 to 90 days.", status: "error" };
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return { message: "Supabase is not configured.", status: "error" };

  let savedSequenceId = sequenceId;
  let createdNewSequence = false;
  if (sequenceId) {
    const { data: updatedSequence, error: updateSequenceError } = await supabase
      .from("sequences")
      .update({ active, campaign, description: description || null, name })
      .eq("id", sequenceId)
      .select("id")
      .maybeSingle();
    if (updateSequenceError) {
      return { message: `Sequence update failed: ${updateSequenceError.message}`, status: "error" };
    }
    if (!updatedSequence) return { message: "The sequence no longer exists.", status: "error" };
  } else {
    const { data: createdSequence, error: createSequenceError } = await supabase
      .from("sequences")
      .insert({ active, campaign, description: description || null, name })
      .select("id")
      .single();
    if (createSequenceError) {
      return { message: `Sequence creation failed: ${createSequenceError.message}`, status: "error" };
    }
    savedSequenceId = createdSequence.id;
    createdNewSequence = true;
  }

  const templateRows = steps.map((step) => ({
    body_text: step.bodyText,
    delay_days: step.delayDays,
    sequence_id: savedSequenceId,
    step: step.step,
    subject: step.subject,
  }));
  const { error: templateError } = await supabase
    .from("templates")
    .upsert(templateRows, { onConflict: "sequence_id,step" });
  if (templateError) {
    if (createdNewSequence) {
      await supabase.from("sequences").delete().eq("id", savedSequenceId);
    }
    return { message: `Sequence steps failed to save: ${templateError.message}`, status: "error" };
  }

  revalidatePath("/");
  return {
    message: `${name} saved with ${steps.length} step${steps.length === 1 ? "" : "s"}.`,
    status: "success",
  };
}
