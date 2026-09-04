import { z } from "zod";

/**
 * MintIQ Deal Memo schema.
 * This is the contract between the synthesis agent (structured output) and the UI.
 * Every field is required (nullable where data may be missing) so the JSON schema
 * stays strict and the memo renders predictably.
 */

export const MINT_INDUSTRIES = [
  "Construction",
  "Specialty Trade Contractors",
  "Logistics & Transportation",
  "Manufacturing",
  "Distribution",
  "Service Businesses",
  "Other",
] as const;

export const MINT_PRODUCTS = [
  "Structured Term Loan",
  "Business Line of Credit",
  "Strategic Financing",
  "Not a fit",
  "Needs more information",
] as const;

const Severity = z.enum(["high", "medium", "low"]);

export const DealMemoSchema = z.object({
  business: z.object({
    legal_name: z.string(),
    dba: z.string().nullable(),
    website: z.string().nullable(),
    location: z.string().describe("City, ST"),
    industry: z.string().describe("Plain-language industry, e.g. 'Commercial HVAC contractor'"),
    mint_industry_bucket: z.enum(MINT_INDUSTRIES),
    years_in_business: z.string().nullable(),
    estimated_annual_revenue: z.string().nullable().describe("e.g. '$3M–$5M (estimated)'"),
    employees: z.string().nullable(),
    ownership: z.string().nullable(),
    entity_status: z.string().nullable().describe("Florida Sunbiz / Secretary of State status if found"),
    licenses: z.array(z.string()),
  }),
  verdict: z.object({
    headline: z.string().describe("One-line verdict, e.g. 'Strong term-loan candidate with MCA cleanup upside'"),
    summary: z.string().describe("3–5 sentence executive summary written for a senior capital advisor"),
    fit_score: z.number().int().min(0).max(100),
    confidence: z.enum(["low", "medium", "high"]),
    recommended_product: z.enum(MINT_PRODUCTS),
    recommended_structure: z.string().describe("e.g. '$650K structured term loan, 48–60 months, fixed monthly payments, secured by fleet and equipment'"),
    suggested_range: z.string().describe("e.g. '$500K – $750K'"),
    key_takeaways: z.array(z.string()).min(3).max(6),
    next_steps: z.array(z.string()).min(2).max(6).describe("Concrete actions for the Mint advisor"),
    talking_points: z.array(z.string()).min(2).max(5).describe("What the advisor should say on the first call"),
  }),
  score_breakdown: z.array(
    z.object({
      factor: z.string(),
      score: z.number().int().min(0).max(10),
      rationale: z.string(),
    }),
  ).min(5).max(8),
  cases: z.object({
    upside: z.object({ title: z.string(), thesis: z.string(), drivers: z.array(z.string()).min(2).max(5) }),
    downside: z.object({ title: z.string(), thesis: z.string(), drivers: z.array(z.string()).min(2).max(5) }),
    base: z.object({ title: z.string(), thesis: z.string(), drivers: z.array(z.string()).min(2).max(5) }),
  }),
  risk_flags: z.array(
    z.object({
      severity: Severity,
      title: z.string(),
      description: z.string(),
      source_url: z.string().nullable(),
    }),
  ),
  financial_snapshot: z.object({
    documents_reviewed: z.array(z.string()),
    revenue_trend: z.array(z.object({ period: z.string(), revenue: z.number() })),
    monthly_deposits: z.array(z.object({ month: z.string(), deposits: z.number(), ending_balance: z.number().nullable() })),
    metrics: z.array(z.object({ label: z.string(), value: z.string(), note: z.string().nullable() })),
    existing_obligations: z.array(
      z.object({ creditor: z.string(), type: z.string(), payment: z.string(), frequency: z.string() }),
    ),
    nsf_count: z.number().int().nullable(),
    analyst_notes: z.string(),
  }).nullable().describe("null when no financial documents were provided"),
  reputation: z.object({
    google_rating: z.number().nullable(),
    google_review_count: z.number().int().nullable(),
    yelp_rating: z.number().nullable(),
    bbb_rating: z.string().nullable(),
    sentiment_summary: z.string(),
    highlights: z.array(z.string()),
  }),
  findings: z.array(
    z.object({
      category: z.enum(["Business Profile", "Reputation", "Public Records", "Industry", "Financials"]),
      title: z.string(),
      detail: z.string(),
      source_url: z.string().nullable(),
      date: z.string().nullable(),
    }),
  ).min(4),
  briefing_script: z.array(
    z.object({ speaker: z.enum(["Analyst", "Advisor"]), line: z.string() }),
  ).min(8).max(18).describe("A two-voice 60–90 second audio briefing for the deal desk"),
  disclaimer: z.string(),
});

export type DealMemo = z.infer<typeof DealMemoSchema>;

/** Intake payload posted by the UI. */
export interface IntakeFile {
  name: string;
  media_type: string;
  /** base64, no newlines */
  data: string;
}

export interface IntakeRequest {
  business_name: string;
  website?: string;
  city?: string;
  state?: string;
  industry?: string;
  requested_amount?: string;
  use_of_funds?: string;
  notes?: string;
  /** Optional: email the finished memo to this address. */
  notify_email?: string;
  files?: IntakeFile[];
}

/** Stages of the research committee, in the order the UI shows them. */
export const STAGES = [
  { id: "profile", label: "Business Profile", short: "Profile", tier: 1 },
  { id: "reputation", label: "Reputation & Digital Footprint", short: "Reputation", tier: 1 },
  { id: "records", label: "Public Records & Liens", short: "Records", tier: 1 },
  { id: "industry", label: "Industry & Market", short: "Industry", tier: 1 },
  { id: "financials", label: "Financial Statements", short: "Financials", tier: 1 },
  { id: "cases", label: "Upside / Downside / Base", short: "Cases", tier: 2 },
  { id: "synthesis", label: "Deal Memo Synthesis", short: "Memo", tier: 3 },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

/** Server-sent events streamed to the UI. */
export type AgentEvent =
  | { type: "run_start"; run_id: string; business_name: string; model: string }
  | { type: "stage"; stage: StageId; status: "start" | "done" | "skipped" | "error"; label?: string; note?: string; duration_ms?: number }
  | { type: "search"; stage: StageId; query: string }
  | { type: "search_result"; stage: StageId; count: number; titles: string[] }
  | { type: "thinking"; stage: StageId; text: string }
  | { type: "text"; stage: StageId; text: string }
  | { type: "memo"; memo: DealMemo }
  | { type: "saved"; token: string; url: string }
  | { type: "stats"; duration_ms: number; input_tokens: number; output_tokens: number; searches: number }
  | { type: "error"; message: string; stage?: StageId }
  | { type: "done" };
