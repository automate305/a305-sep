import type { IntakeRequest } from "../../shared/schema.js";

/**
 * Normalizes a submission from Mint's "Capital Pre-Qualification" form (or any
 * form builder / Zapier / Make payload) into a MintIQ intake. Field names are
 * matched case-insensitively with spaces, dashes, and camelCase flattened, so
 * "Legal Business Name", legal_business_name, and legalBusinessName all match.
 */

export interface NormalizedSubmission {
  intake: IntakeRequest;
  contact: { name: string | null; email: string | null; phone: string | null };
  notify_to: string | null;
  sample: boolean;
  unmapped: Record<string, unknown>;
}

const norm = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s\-.]+/g, "_").toLowerCase();

const FIELDS: Record<string, string[]> = {
  business_name: ["legal_business_name", "business_name", "company", "company_name", "business", "legal_name", "dba"],
  website: ["website", "url", "company_website", "site"],
  city: ["city", "business_city"],
  state: ["state", "business_state", "region"],
  industry: ["industry", "business_type", "vertical", "sector"],
  requested_amount: ["requested_amount", "amount", "capital_needed", "loan_amount", "funding_amount", "how_much", "amount_requested"],
  use_of_funds: ["use_of_funds", "purpose", "use", "funding_purpose", "what_for"],
  primary_goal: ["primary_goal", "goal", "product", "product_interest", "capital_solution"],
  annual_revenue: ["gross_annual_revenue", "annual_revenue", "revenue", "yearly_revenue", "revenue_range", "revenue_bucket"],
  years_in_business: ["years_in_business", "time_in_business", "years"],
  first_name: ["first_name", "firstname", "fname"],
  last_name: ["last_name", "lastname", "lname"],
  full_name: ["name", "full_name", "contact_name", "owner_name"],
  email: ["email", "email_address", "contact_email", "work_email"],
  phone: ["phone", "phone_number", "mobile", "contact_phone"],
  notes: ["notes", "message", "comments", "additional_info", "details"],
  notify_email: ["notify_email", "advisor_email", "send_to", "deliver_to"],
  sample: ["sample", "demo", "test"],
};

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}_${norm(k)}` : norm(k);
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
    // Also expose the leaf name alone so nested {applicant:{first_name}} still matches.
    if (prefix && !(norm(k) in out)) out[norm(k)] = v;
  }
  return out;
}

export function normalizeSubmission(payload: unknown): NormalizedSubmission {
  const flat = flatten(payload);
  const used = new Set<string>();
  const pick = (field: string): string | null => {
    for (const cand of FIELDS[field]) {
      const v = flat[cand];
      if (v !== undefined && v !== null && String(v).trim() !== "") { used.add(cand); return String(v).trim(); }
    }
    return null;
  };

  const business_name = pick("business_name") ?? "";
  const first = pick("first_name"), last = pick("last_name");
  const name = pick("full_name") ?? ([first, last].filter(Boolean).join(" ") || null);
  const email = pick("email"), phone = pick("phone");
  const goal = pick("primary_goal"), revenue = pick("annual_revenue"), years = pick("years_in_business");
  const notes = pick("notes");
  const sampleRaw = pick("sample");
  const sample = sampleRaw !== null && ["1", "true", "yes", "y"].includes(sampleRaw.toLowerCase());

  const contextLines = [
    goal ? `Applicant selected primary goal: ${goal}` : null,
    revenue ? `Self-reported gross annual revenue: ${revenue}` : null,
    years ? `Self-reported years in business: ${years}` : null,
    name ? `Contact: ${name}${email ? ` <${email}>` : ""}${phone ? ` ${phone}` : ""}` : null,
    notes ? `Applicant notes: ${notes}` : null,
    "Source: Mint Financial Group pre-qualification form (self-reported; verify every figure).",
  ].filter(Boolean) as string[];

  const intake: IntakeRequest = {
    business_name,
    website: pick("website") ?? undefined,
    city: pick("city") ?? undefined,
    state: pick("state") ?? undefined,
    industry: pick("industry") ?? undefined,
    requested_amount: pick("requested_amount") ?? undefined,
    use_of_funds: pick("use_of_funds") ?? goal ?? undefined,
    notes: contextLines.join("\n"),
    notify_email: pick("notify_email") ?? undefined,
  };

  const unmapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) if (!used.has(k) && !k.includes("_")) unmapped[k] = v;

  return { intake, contact: { name, email, phone }, notify_to: intake.notify_email ?? null, sample, unmapped };
}
