# MintIQ

Borrower intelligence and deal memos for [Mint Financial Group](https://mintfinancialgroup.com).
Type in an applicant, optionally drop in their bank statements and P&Ls, and a five-analyst
research committee on the Claude API returns a structured pre-underwriting deal memo: fit score,
recommended Mint product and structure, upside/downside/base cases, risk flags, sourced findings,
financial snapshot, and a two-voice audio briefing.

Built by [Automate305](https://automate305.com). From Miami with love. 🤍

## How it works

| Tier | Agent | Inputs | Tools |
|------|-------|--------|-------|
| 1 | Business Profile | intake | web search |
| 1 | Reputation & Digital Footprint | intake | web search |
| 1 | Public Records & Liens (UCC / MCA detection) | intake | web search |
| 1 | Industry & Market | intake | web search |
| 1 | Financial Statements | uploaded PDFs / images / CSV | document vision |
| 2 | Credit Committee (upside / downside / base + product fit + rubric) | all Tier 1 output | none |
| 3 | Deal Desk synthesis | everything | structured output (`shared/schema.ts`) |

Tier 1 runs in parallel and streams every search query, result, and reasoning summary to the UI
over Server-Sent Events. The memo is validated against a Zod schema before it renders.

The audio briefing plays in the browser through the Web Speech API, so no audio service is needed.

## Intake webhook (Mint's pre-qualification form → memo in the inbox)

`POST /api/intake-webhook` accepts a submission from Mint's "Capital Pre-Qualification" form, a
form builder, Zapier, or Make. Field names are matched loosely (`Legal Business Name`,
`legal_business_name`, and `legalBusinessName` all work; same for goal, revenue, contact, website,
city, state, amount, use of funds). It answers `202` right away with the memo link, runs the
committee in the background, saves the memo, and emails it to `notify_email` in the payload or
`MINTIQ_NOTIFY_TO`.

```bash
curl -X POST https://<host>/api/intake-webhook \
  -H "content-type: application/json" -H "x-mintiq-secret: $MINTIQ_WEBHOOK_SECRET" \
  -d '{"Primary Goal":"Business Line of Credit","Legal Business Name":"Acme Corp LLC",
       "First Name":"John","Last Name":"Doe","Email":"john@acme.com",
       "Gross Annual Revenue":"$2 Million – $10 Million+","website":"acme.com","city":"Miami","state":"FL"}'
```

Send `{"sample": true}` to exercise the whole loop with the fictional sample deal at no API cost.

Memos are archived in Supabase (`supabase/schema.sql`, table `mintiq_memos`) and served at
`/m/<token>`; the UI's own runs get the same share link. Without Supabase credentials the archive
is in-memory, which is fine locally but not on Vercel.

## Run locally

```bash
cd mintiq
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY
npm run dev                 # http://localhost:3000
```

Without a key the app still serves the built-in sample deal ("Watch the sample deal"), which
replays a recorded committee run and a fictional memo. Nothing in the sample is real.

## Deploy to Vercel

1. Import the repo (root directory `mintiq/` if it lives inside a monorepo).
2. Framework preset: Vite. Build command and output directory are set in `vercel.json`.
3. Add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables.
4. Deploy. `api/index.ts` runs the Express app as a serverless function with a 300 s limit.

Vercel caps request bodies at about 4.5 MB, so uploads are limited to 2.8 MB of raw files in the
hosted demo. Self-host with `npm start` behind a reverse proxy to raise the limit.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | Required for live analysis |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | — | Memo archive (same names as a305-sep) |
| `MINTIQ_WEBHOOK_SECRET` | — | Enables `/api/intake-webhook` |
| `MINTIQ_PUBLIC_URL` | request host | Base URL for memo links in emails |
| `MINTIQ_SMTP_USER`, `MINTIQ_SMTP_PASS` | — | Memo email delivery (Hostinger SMTP by default) |
| `MINTIQ_SMTP_HOST`, `MINTIQ_SMTP_PORT`, `MINTIQ_FROM` | `smtp.hostinger.com`, `465`, user | SMTP overrides |
| `MINTIQ_NOTIFY_TO` | — | Default recipient(s) for webhook memos |
| `MINTIQ_MODEL` | `claude-opus-5` | Model for every stage |
| `MINTIQ_SEARCHES_PER_AGENT` | `6` | Web-search budget per Tier 1 analyst |
| `MINTIQ_MAX_BODY` | `4mb` | Request body cap for uploads (raise when self-hosting) |
| `PORT` | `3000` | Local server port |

## Cost and timing

A full run is roughly 5–7 model calls, 20–25 web searches, and 150–250K tokens. On Claude Opus 5
that is on the order of a few dollars per applicant and takes two to four minutes. Lower
`MINTIQ_SEARCHES_PER_AGENT` or set `MINTIQ_MODEL=claude-sonnet-5` to trade depth for speed.

## Layout

```
mintiq/
  api/index.ts          Vercel serverless entry (Express app)
  server.ts             Local dev + self-hosted server (Vite middleware in dev)
  server/app.ts         Routes: /api/analyze (SSE), /api/intake-webhook, /api/memos/:token, /api/sample, /api/health
  server/lib/store.ts   Memo archive (Supabase or in-memory) and share tokens
  server/lib/mailer.ts  Branded memo email (nodemailer)
  server/lib/webhook.ts Normalizes form payloads into an intake
  server/lib/claude.ts  Streaming stage runner (web search, thinking, pause_turn, refusal fallback)
  server/lib/pipeline.ts  The research committee
  server/lib/prompts.ts   Mint context + per-agent instructions
  shared/schema.ts      Deal memo schema (Zod) + event types
  shared/sample.ts      Fictional sample deal and replay timeline
  src/                  React UI (intake, live committee board, deal memo, audio briefing)
```

## Branding

Palette and logo follow Mint Financial Group: navy `#0b1530` / `#1b2d63`, gold `#ebb43b` /
`#c9a84c` / `#a88656`, emerald `#10b981` for positive signals, cream `#f5f2ea` for the memo.
The logo is recreated as an SVG in `src/components/Logo.tsx`; to use the official artwork, place
`mfg-logo.png` in `public/` and set `USE_PNG` to `true`.

MintIQ is AI-assisted pre-underwriting research, not a credit decision.
