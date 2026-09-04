# MintIQ — handoff prompt for Codex

You are working in the `mintiq/` folder of the repo `automate305/a305-sep`, branch
`claude/mint-financial-website-gaj55j` (open draft PR #12). Everything below the folder is a
self-contained Vite + React 19 + Tailwind v4 app with an Express API that runs locally via
`npm run dev` and on Vercel via `api/index.ts` (project "mintiq", root directory `mintiq`,
production builds from `main`). Read `README.md` first.

## What MintIQ is
Borrower-intelligence desk for Mint Financial Group (Sunrise, FL capital advisory: structured
term loans, business lines of credit, strategic financing for $1M–$20M businesses). An advisor
enters an applicant (or Mint's pre-qual form posts it to `/api/intake-webhook`), and a
"research committee" on the Claude API produces a deal memo:
- Tier 1 in parallel: `profile`, `reputation`, `records`, `industry` (web search) + `financials` (uploaded PDFs/images/CSV).
- Tier 2: `cases` (upside / downside / base + product fit, 0–100 rubric).
- Tier 3: `synthesis` → JSON validated against `shared/schema.ts` (`DealMemoSchema`), stored in Supabase (`mintiq_memos`), served at `/m/<token>`, optionally emailed.

Key files: `server/lib/pipeline.ts` (stages), `server/lib/claude.ts` (streaming stage runner),
`server/lib/prompts.ts`, `server/app.ts` (routes + SSE), `server/lib/{store,mailer,webhook}.ts`,
`src/App.tsx`, `src/lib/api.ts` (client orchestration), `src/components/*`, `shared/sample.ts`
(fictional demo memo + replay).

## Verified state (do not regress)
- Live end-to-end run works: 4 researchers ≈ 50–75 s each in parallel, cases ≈ 35 s,
  synthesis ≈ 100 s; total ≈ 200–280 s; ≈ 20–25 web searches; ≈ 160K input / 22K output tokens.
- The UI uses the per-stage endpoints (`/api/stage/research|financials|cases|synthesis`) so no
  single request approaches Vercel's 300 s limit. `/api/analyze` (single request) remains for
  local/self-hosted use and for the webhook path.
- Synthesis uses JSON-in-text + Zod validation + one repair pass. Grammar-constrained structured
  output was removed on purpose: the schema is too large ("compiled grammar is too large").
- Server imports use `.js` specifiers for `.ts` files (required by Vercel's TS compile). Keep it.
- Abort handling listens on `res.on("close")`, not `req.on("close")` (the latter fires as soon
  as the body is read and killed every run).
- `.card` utility in `src/index.css` forces a white background; dark cards must not use it.

## Conventions
- `npm run lint` (tsc --noEmit) and `npm run build` must pass before every commit.
- Never commit secrets. Env vars are documented in `.env.example`. Do not add `.env` files.
- Keep changes inside `mintiq/`. Do not touch the rest of the repo.
- Brand: navy `#0b1530`/`#1b2d63`, gold `#ebb43b`/`#c9a84c`/`#a88656`, emerald `#10b981` for
  positive signals, cream `#f5f2ea` memo surface. Logo components live in `src/components/Logo.tsx`.
- Commit messages: imperative, explain why. Small commits per fix.

## Fixes to make, in priority order

1. **Protect the spend.** The app is public once deployed and every run costs real money.
   Add an app-level gate: `MINTIQ_APP_PASSWORD` env; the intake page asks for it once and stores
   a signed cookie or bearer token; all `/api/stage/*` and `/api/analyze` calls require it.
   `/api/sample`, `/api/health`, and `/m/<token>` stay open. Also add a per-IP limiter on the
   stage endpoints (e.g. 10 runs/hour) with a clear error message in the UI.

2. **Webhook path must survive Vercel's 300 s cap.** `/api/intake-webhook` currently runs the
   whole committee inside one invocation via `waitUntil`. Restructure as a self-chaining job:
   store a job row in Supabase (`mintiq_jobs`: token, intake, stage outputs, status, error),
   have the webhook return 202 immediately, then run Tier 1 → cases → synthesis as separate
   invocations that trigger the next step by `fetch`-ing the app's own URL with the webhook
   secret (respect `MINTIQ_PUBLIC_URL`; pass `x-vercel-protection-bypass` when
   `VERCEL_AUTOMATION_BYPASS_SECRET` is set). Add the SQL to `supabase/schema.sql`. The
   in-memory fallback in `store.ts` must keep working locally.

3. **Search-query hygiene.** Occasionally a researcher emits a malformed query (a lone `"` or a
   non-English token). In `server/lib/claude.ts`, ignore/skip queries shorter than 3 chars when
   counting and emitting, and add one sentence to `searchBudgetNote` in `prompts.ts` telling the
   analyst to write plain English queries with the business name in quotes.

4. **Advisor archive page.** Add `/archive` (behind the app password) listing recent memos from
   Supabase (business name, fit score, product, date, source, link). Add `GET /api/memos` with
   pagination. Keep the memo page itself token-addressed.

5. **Uploads beyond Vercel's 4.5 MB body cap.** Move document uploads to Supabase Storage
   (signed upload URL from the server, bucket `mintiq-uploads`, private), pass storage paths to
   `/api/stage/financials`, download server-side, and delete the objects after the run. Raise the
   client cap accordingly. Keep the current base64 path as fallback when storage is not configured.

6. **Audio briefing quality.** Web Speech voices vary by browser. Add an optional ElevenLabs path:
   `ELEVENLABS_API_KEY` env, `POST /api/briefing-audio` that renders the two-speaker script with
   two voices and returns MP3 (cache by memo token in Supabase Storage). The UI should prefer the
   server audio when available and fall back to Web Speech.

7. **Run telemetry.** Persist per-run stats (duration, tokens, searches, model, source, estimated
   cost at Opus 5 rates: $5/M input, $25/M output, $10 per 1K searches) in `mintiq_memos.stats`
   (already exists) and show a small "cost" line in the memo footer for advisors.

8. **Tests.** Add Vitest with unit tests for `server/lib/webhook.ts` (`normalizeSubmission` field
   matching, including nested payloads and the `sample` flag), `extractJson` and `normalizeMemo`
   in `pipeline.ts`, and `renderMemoEmail` (subject line, escaping). Add `npm test` and run it in
   the build command only if it stays under a few seconds.

9. **Polish.** Committee board: on screens between 1280 and 1536 px the five Tier 1 cards wrap
   3 + 2; consider 5 narrower columns at `xl`. Memo print stylesheet is untested: verify
   `window.print()` produces clean pages (hide header/buttons, avoid mid-card breaks).

## Acceptance
- `npm run lint`, `npm run build`, and `npm test` pass.
- The sample deal still runs with no API key. `/api/health` reports `store`, `mail`, `webhook`.
- A live run through the UI completes and saves a memo; the webhook returns 202 in under 2 s and
  the memo appears at the returned URL within ~5 minutes on Vercel.
- README updated for every new env var and route.
