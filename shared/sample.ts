import type { AgentEvent, DealMemo, IntakeRequest } from "./schema.ts";

/**
 * A fictional sample deal so MintIQ can be demoed with no API key and no network.
 * "Coastal Breeze Mechanical" does not exist; every figure below is invented.
 */
export const SAMPLE_INTAKE: IntakeRequest = {
  business_name: "Coastal Breeze Mechanical, LLC",
  website: "coastalbreezemechanical.com",
  city: "Fort Lauderdale",
  state: "FL",
  industry: "Specialty Trade Contractors",
  requested_amount: "$650,000",
  use_of_funds: "Consolidate two merchant cash advances, add three service vans, and purchase a rooftop-unit crane truck for commercial work.",
  notes: "Referred by a restoration partner. Owner says the bank passed because of the MCA debits.",
};

export const SAMPLE_MEMO: DealMemo = {
  business: {
    legal_name: "Coastal Breeze Mechanical, LLC",
    dba: "Coastal Breeze AC",
    website: "coastalbreezemechanical.com",
    location: "Fort Lauderdale, FL",
    industry: "Commercial and residential HVAC contractor (install, service, maintenance agreements)",
    mint_industry_bucket: "Specialty Trade Contractors",
    years_in_business: "15 years (Florida LLC filed 2011)",
    estimated_annual_revenue: "$4.2M (2025, per P&L); tracking ~$4.9M annualized in 2026",
    employees: "34 (per Google Business Profile and LinkedIn headcount)",
    ownership: "Owner-operated; Daniel Reyes (President, 100%)",
    entity_status: "Active — Florida Division of Corporations, annual report filed",
    licenses: ["FL Class A Air Conditioning Contractor CAC1821904 (active)", "EPA 608 Universal (technicians)", "Broward County Business Tax Receipt (current)"],
  },
  verdict: {
    headline: "Strong term-loan candidate: healthy growth story being strangled by stacked MCA debits.",
    summary:
      "Coastal Breeze is a 15-year-old, owner-operated HVAC contractor with $4.2M in 2025 revenue and 2026 deposits running 27% ahead of last year, driven by a growing commercial maintenance book. The business is fundamentally sound: strong reviews, active licensing, clean public records, and real collateral in fleet and equipment. The problem is capital structure, not the operation. Two merchant cash advances are pulling roughly $67K a month out of operating cash on daily and weekly debits, which is why the bank passed and why the owner has run two NSF items this spring. A $650K–$750K structured term loan that retires both positions and funds the fleet expansion converts that burden into a single fixed monthly payment and frees an estimated $50K a month of cash flow. This is exactly the profile Mint exists for.",
    fit_score: 78,
    confidence: "medium",
    recommended_product: "Structured Term Loan",
    recommended_structure: "$700K structured term loan, 60 months, fixed monthly payment (~$15.5K), first-position UCC on fleet and equipment, no personal real estate",
    suggested_range: "$650K – $750K",
    key_takeaways: [
      "Revenue has compounded 16% a year since 2023 and 2026 is pacing higher on commercial maintenance contracts.",
      "Two MCA positions (Forward Financing, Rapid Finance) cost ~$67K/month; consolidation is the whole thesis.",
      "Reputation is a genuine asset: 4.8 stars on 312 Google reviews with steady velocity, BBB A+.",
      "Public records are clean apart from the two UCC filings tied to the MCAs; no liens, judgments, or license discipline found.",
      "Collateral is real and titled: 11-vehicle fleet plus shop equipment supports a first-position structure.",
    ],
    next_steps: [
      "Request MCA payoff letters from Forward Financing and Rapid Finance to lock the consolidation amount.",
      "Pull a full 12-month bank package plus 2024 and 2025 business tax returns.",
      "Order fleet valuation (11 units) and confirm titles are free of Ford Credit beyond the two financed vans.",
      "Run a paid UCC and lien search (Experian Business or LexisNexis) before issuing a term sheet.",
    ],
    talking_points: [
      "You do not have a business problem, you have a structure problem, and structure is what we fix.",
      "One monthly payment instead of a daily ACH means roughly fifty thousand dollars a month stays in your operating account.",
      "We structure against the fleet and equipment, not your house.",
    ],
  },
  score_breakdown: [
    { factor: "Revenue scale vs. Mint sweet spot", score: 8, rationale: "$4.2M sits squarely in the $2M–$10M sweet spot with growth." },
    { factor: "Cash-flow consistency", score: 6, rationale: "Deposits are strong and rising but two NSF items in April and May show MCA strain." },
    { factor: "Time in business & stability", score: 9, rationale: "15 years, same owner, active license, same location since 2016." },
    { factor: "Reputation & social proof", score: 9, rationale: "4.8 on 312 Google reviews, BBB A+, consistent recent review velocity." },
    { factor: "Public-records risk", score: 8, rationale: "No liens, judgments, or discipline found online; UCCs are the MCA positions themselves." },
    { factor: "Existing leverage / stacking", score: 4, rationale: "Two active MCAs at ~$67K/month is the primary risk and the reason for the loan." },
    { factor: "Industry outlook", score: 7, rationale: "South Florida HVAC demand is durable; refrigerant transition and labor costs are headwinds." },
  ],
  cases: {
    upside: {
      title: "Consolidate and compound",
      thesis: "Retiring the MCAs restores ~$50K/month in operating cash while the commercial maintenance book keeps growing. The fleet expansion lifts capacity into a market that is still short on licensed technicians, and the owner has already proven he can scale headcount.",
      drivers: ["27% deposit growth year-over-year", "Recurring maintenance agreements now ~30% of revenue", "Crane truck opens rooftop commercial replacements at higher margins", "Debt service falls from ~$73K to ~$22K per month"],
    },
    downside: {
      title: "Stacking recurs",
      thesis: "If the owner takes another advance after consolidation, or if a slow winter combines with the new payment, the position weakens quickly. Concentration in a few property-management clients and the residential slowdown from higher insurance costs are the pressure points.",
      drivers: ["Top three commercial clients are ~40% of deposits", "Residential replacements sensitive to homeowner insurance shock in Broward", "Owner dependence: no second-tier manager identified", "A2L refrigerant transition raises inventory cost in 2026"],
    },
    base: {
      title: "Clean structure, steady growth",
      thesis: "Revenue lands near $4.8M in 2026, the term loan services comfortably at roughly 2.1x coverage after consolidation, and the fleet additions are absorbed by existing demand. Covenants: no new short-term debt without consent; monthly bank statement reporting for the first year.",
      drivers: ["DSCR ~2.1x post-consolidation on 2026 run-rate", "Fleet collateral covers ~60% of principal at forced-sale values", "Owner motivated: bank rejection plus daily debits are the pain"],
    },
  },
  risk_flags: [
    { severity: "high", title: "Two stacked MCA positions", description: "Forward Financing (daily $1,850) and Rapid Finance (weekly $6,200) total ~$67K/month, roughly 16% of monthly deposits.", source_url: null },
    { severity: "medium", title: "Two NSF items in 90 days", description: "Returned items on Apr 14 and May 22, 2026, both on MCA debit days. Balances recovered within 48 hours each time.", source_url: null },
    { severity: "medium", title: "Customer concentration", description: "Three property-management clients account for roughly 40% of commercial deposits.", source_url: null },
    { severity: "low", title: "Refrigerant transition costs", description: "2026 A2L refrigerant rules raise equipment and inventory costs industry-wide; manageable but compresses margin on smaller residential jobs.", source_url: "https://www.epa.gov/climate-hfcs-reduction" },
  ],
  financial_snapshot: {
    documents_reviewed: ["2025 P&L (CPA-compiled)", "2024 P&L", "Chase operating account statements Feb–Jul 2026", "Debt schedule (owner-prepared)"],
    revenue_trend: [
      { period: "2023", revenue: 3100000 },
      { period: "2024", revenue: 3700000 },
      { period: "2025", revenue: 4200000 },
      { period: "2026 YTD (Jul)", revenue: 2900000 },
    ],
    monthly_deposits: [
      { month: "Feb 26", deposits: 348000, ending_balance: 41200 },
      { month: "Mar 26", deposits: 372000, ending_balance: 38400 },
      { month: "Apr 26", deposits: 401000, ending_balance: 52100 },
      { month: "May 26", deposits: 455000, ending_balance: 46900 },
      { month: "Jun 26", deposits: 512000, ending_balance: 63300 },
      { month: "Jul 26", deposits: 538000, ending_balance: 71800 },
    ],
    metrics: [
      { label: "Avg monthly deposits (6 mo)", value: "$437,700", note: "Up 27% vs. same period 2025" },
      { label: "Gross margin (2025)", value: "38%", note: "Service and maintenance carry the margin" },
      { label: "Net income (2025)", value: "$312,000", note: "Before ~$180K owner add-backs" },
      { label: "Current monthly debt service", value: "$73,400", note: "$67K of it is MCA" },
      { label: "Est. DSCR after consolidation", value: "2.1x", note: "On 2026 run-rate EBITDA" },
      { label: "Lowest balance (6 mo)", value: "$2,100", note: "May 22, MCA debit day" },
    ],
    existing_obligations: [
      { creditor: "Forward Financing", type: "Merchant cash advance", payment: "$1,850", frequency: "Daily (Mon–Fri)" },
      { creditor: "Rapid Finance", type: "Merchant cash advance", payment: "$6,200", frequency: "Weekly" },
      { creditor: "Ford Credit", type: "Vehicle loans (2 vans)", payment: "$4,100", frequency: "Monthly" },
      { creditor: "Chase", type: "Equipment loan", payment: "$2,300", frequency: "Monthly" },
    ],
    nsf_count: 2,
    analyst_notes: "Deposit growth is real and broad-based, not a single large job. The MCA debits explain the balance volatility entirely; strip them out and the account never drops below $45K. Owner add-backs (vehicle, health, one-time legal) are documented in the P&L notes.",
  },
  reputation: {
    google_rating: 4.8,
    google_review_count: 312,
    yelp_rating: 4.5,
    bbb_rating: "A+ (accredited since 2018)",
    sentiment_summary: "Customers consistently praise same-day response and technician professionalism; the few complaints are about pricing on emergency calls, which the company answers publicly. Employee reviews mention a busy but fair shop.",
    highlights: ["Roughly 8–10 new Google reviews per month through summer 2026", "Featured as a Carrier Factory Authorized Dealer", "Active hiring for two commercial techs (growth signal)"],
  },
  findings: [
    { category: "Business Profile", title: "Florida LLC active since 2011, annual report current", detail: "Entity is active with the same registered agent and principal since formation; no amendments or dissolutions.", source_url: "https://search.sunbiz.org/", date: "2026-08" },
    { category: "Business Profile", title: "Class A AC contractor license active", detail: "CAC1821904 shows active status with no disciplinary history in the DBPR license portal.", source_url: "https://www.myfloridalicense.com/", date: "2026-08" },
    { category: "Reputation", title: "4.8 stars across 312 Google reviews", detail: "Review velocity is steady and recent; the owner responds to negative reviews within days.", source_url: null, date: "2026-08" },
    { category: "Public Records", title: "Two UCC-1 filings match the MCA positions", detail: "Secured parties are consistent with Forward Financing and Rapid Finance; no other secured creditors surfaced online. A paid UCC search is still required before closing.", source_url: "https://www.floridaucc.com/", date: "2026-08" },
    { category: "Public Records", title: "No liens, judgments, or OSHA citations found", detail: "County clerk and OSHA establishment searches returned nothing for the entity or DBA.", source_url: "https://www.osha.gov/ords/imis/establishment.html", date: "2026-08" },
    { category: "Industry", title: "South Florida HVAC demand remains durable", detail: "Replacement demand is driven by heat, humidity, and an aging installed base; the 2026 refrigerant transition and technician shortage are the cost pressures.", source_url: "https://www.bls.gov/ooh/installation-maintenance-and-repair/heating-air-conditioning-and-refrigeration-mechanics-and-installers.htm", date: "2026" },
    { category: "Financials", title: "Deposits up 27% year-over-year", detail: "Six-month average of $437.7K per month with an upward trend into peak season.", source_url: null, date: "2026-07" },
  ],
  briefing_script: [
    { speaker: "Analyst", line: "Coastal Breeze Mechanical, Fort Lauderdale. Fifteen-year-old HVAC contractor, owner-operated, about four point two million in revenue last year and growing." },
    { speaker: "Advisor", line: "What made the bank pass?" },
    { speaker: "Analyst", line: "Two merchant cash advances. Daily and weekly debits pulling roughly sixty-seven thousand a month out of the operating account. It caused two NSF items this spring." },
    { speaker: "Advisor", line: "So the operation is fine and the structure is broken." },
    { speaker: "Analyst", line: "Exactly. Reviews are excellent, the license is clean, public records are clean, and the fleet is real collateral." },
    { speaker: "Advisor", line: "What do you want to propose?" },
    { speaker: "Analyst", line: "A structured term loan around seven hundred thousand over sixty months. It retires both advances and funds three vans and a crane truck." },
    { speaker: "Advisor", line: "And the payment?" },
    { speaker: "Analyst", line: "One fixed monthly payment instead of daily drains. That leaves about fifty thousand a month back in the business." },
    { speaker: "Advisor", line: "Where is the risk?" },
    { speaker: "Analyst", line: "Customer concentration and the temptation to stack again. We would want a no-new-short-term-debt covenant and monthly statements for the first year." },
    { speaker: "Advisor", line: "Good. Get the payoff letters and the full twelve-month bank package, and let's book the call." },
  ],
  disclaimer: "MintIQ is AI-assisted pre-underwriting research generated from public sources and applicant-provided documents; it is not a credit decision, and every figure must be verified before any commitment.",
};

/** Simulated committee timeline (ms offsets) so the demo feels live without an API call. */
function buildReplay(): Array<{ at: number; event: AgentEvent }> {
  const out: Array<{ at: number; event: AgentEvent }> = [];
  const push = (at: number, event: AgentEvent) => out.push({ at, event });
  push(0, { type: "run_start", run_id: "run_sample", business_name: SAMPLE_INTAKE.business_name, model: "claude-opus-5 (sample replay)" });
  const t1 = ["profile", "reputation", "records", "industry", "financials"] as const;
  t1.forEach((s, i) => push(200 + i * 150, { type: "stage", stage: s, status: "start" }));

  const script: Array<[number, AgentEvent]> = [
    [900, { type: "thinking", stage: "profile", text: "Starting with the Florida corporate registry to confirm the legal entity, then the DBPR license portal." }],
    [1200, { type: "search", stage: "profile", query: "Coastal Breeze Mechanical LLC Fort Lauderdale sunbiz" }],
    [1100, { type: "thinking", stage: "reputation", text: "Pulling Google, Yelp, and BBB in parallel and checking review velocity over the last 90 days." }],
    [1400, { type: "search", stage: "reputation", query: "Coastal Breeze AC Fort Lauderdale reviews" }],
    [1300, { type: "thinking", stage: "records", text: "Looking for UCC-1 filings first; MCA funders almost always file." }],
    [1600, { type: "search", stage: "records", query: "Coastal Breeze Mechanical UCC filing Florida secured party" }],
    [1500, { type: "thinking", stage: "industry", text: "Framing South Florida HVAC demand: heat load, insurance shock, and the 2026 A2L refrigerant transition." }],
    [1800, { type: "search", stage: "industry", query: "South Florida HVAC contractor outlook 2026 refrigerant transition labor" }],
    [1700, { type: "thinking", stage: "financials", text: "Four documents: two P&Ls, six months of Chase statements, and an owner-prepared debt schedule. Reconciling deposits month by month." }],
    [3200, { type: "search_result", stage: "profile", count: 6, titles: ["Florida Division of Corporations — entity detail", "DBPR License Search", "Coastal Breeze Mechanical | About Us"] }],
    [3400, { type: "search_result", stage: "reputation", count: 8, titles: ["Coastal Breeze AC — Google Business Profile", "Yelp: Coastal Breeze Mechanical", "BBB Business Profile"] }],
    [3600, { type: "search_result", stage: "records", count: 5, titles: ["Florida Secured Transaction Registry", "Broward County Clerk — Official Records"] }],
    [3800, { type: "search_result", stage: "industry", count: 7, titles: ["BLS: HVACR mechanics and installers", "EPA: HFC phasedown and A2L transition", "South Florida Business Journal"] }],
    [4300, { type: "search", stage: "profile", query: "CAC1821904 license status Florida" }],
    [4500, { type: "thinking", stage: "financials", text: "Daily $1,850 and weekly $6,200 ACH debits identified: two merchant cash advances totaling about $67K per month." }],
    [4700, { type: "search", stage: "reputation", query: "Coastal Breeze Mechanical BBB complaints" }],
    [4900, { type: "search", stage: "records", query: "Coastal Breeze Mechanical lawsuit OR judgment OR lien Broward" }],
    [5100, { type: "search", stage: "industry", query: "Broward County homeowners insurance 2026 impact HVAC replacements" }],
    [6400, { type: "search_result", stage: "profile", count: 3, titles: ["DBPR: Certified Air Conditioning Contractor — Active"] }],
    [6600, { type: "thinking", stage: "reputation", text: "312 Google reviews at 4.8, roughly eight to ten new reviews a month. Owner answers the negative ones." }],
    [6800, { type: "search_result", stage: "records", count: 4, titles: ["Broward Clerk: no results for entity name", "OSHA Establishment Search"] }],
    [7000, { type: "thinking", stage: "industry", text: "Demand is durable; margin pressure is the story, not volume." }],
    [7600, { type: "thinking", stage: "financials", text: "Two NSF items, both on MCA debit days. Strip the MCAs and the account never dips below $45K." }],
    [8200, { type: "stage", stage: "profile", status: "done", duration_ms: 8000 }],
    [8600, { type: "stage", stage: "reputation", status: "done", duration_ms: 8300 }],
    [9000, { type: "stage", stage: "records", status: "done", duration_ms: 8600 }],
    [9300, { type: "stage", stage: "industry", status: "done", duration_ms: 8800 }],
    [9700, { type: "stage", stage: "financials", status: "done", duration_ms: 9000 }],
    [10000, { type: "stage", stage: "cases", status: "start" }],
    [10600, { type: "thinking", stage: "cases", text: "Upside: consolidation frees ~$50K/month and the maintenance book is compounding." }],
    [11800, { type: "thinking", stage: "cases", text: "Downside: concentration in three property managers and the risk of re-stacking." }],
    [13000, { type: "thinking", stage: "cases", text: "Rubric: 50 + 12 revenue + 6 cash flow + 9 stability + 9 reputation − 3 records − 12 leverage + 7 industry = 78." }],
    [14200, { type: "stage", stage: "cases", status: "done", duration_ms: 4200 }],
    [14500, { type: "stage", stage: "synthesis", status: "start" }],
    [15200, { type: "thinking", stage: "synthesis", text: "Writing the memo for the first call: structure problem, not a business problem." }],
    [17400, { type: "thinking", stage: "synthesis", text: "Recommended product: Structured Term Loan, $650K–$750K, 60 months, fleet and equipment collateral." }],
    [19000, { type: "stage", stage: "synthesis", status: "done", duration_ms: 4500 }],
    [19200, { type: "memo", memo: SAMPLE_MEMO }],
    [19300, { type: "stats", duration_ms: 19300, input_tokens: 186420, output_tokens: 21870, searches: 22 }],
    [19400, { type: "done" }],
  ];
  for (const [at, ev] of script) push(at, ev);
  return out.sort((a, b) => a.at - b.at);
}

export const SAMPLE_REPLAY = buildReplay();
