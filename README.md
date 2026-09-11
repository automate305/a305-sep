# Automate305 SEP
**Simple Sales Engagement Platform**
Supabase (state) + provider-routed SMTP (sending) + Vercel (webhook) + Cowork (trigger)

Runs **multiple campaigns from one engine**, each with its own senders and copy:

| Campaign | Sequences | Sends from | Copy |
|----------|-----------|------------|------|
| `aesthetic` | `dp4`, `clearview` | Hostinger · `aestheticdevicepro.com` (matt@ / tamiko@) | Device outreach |
| `hvac` | `hvac_a`, `hvac_b` | Google Workspace · `automate305.com` (cam@) | Automate305 HVAC / South Florida (ColdIQ copy) |

Each sequence is tagged with a `campaign`, and the sender for every email is
picked from the **same campaign** — so HVAC mail never goes out from the
aesthetic mailboxes, and vice versa.

---

## Deploy in 4 steps

### Step 1 — Supabase
1. Go to [supabase.com](https://supabase.com) → New project → name it `a305-sep`
2. SQL Editor → paste and run `supabase/schema.sql`
3. Copy your **Project URL** and **service_role key** from Settings → API

### Step 2 — Vercel
1. Push this folder to a GitHub repo (or drag to vercel.com/new)
2. Add all env vars from `.env.example` in Vercel → Settings → Environment Variables
3. Deploy — note your URL (e.g. `https://a305-sep.vercel.app`)

### Step 3 — Local setup (Cowork trigger)
```bash
npm install
cp .env.example .env.local
# Fill in your local values; never commit .env.local
npm run dev
```

Open `http://localhost:3000` for the server-rendered outreach dashboard. It
reads the existing Supabase views and tables on the server; the service-role
key is never included in client code. `DASHBOARD_ACCESS_KEY` protects contact
data and the approval controls with an HttpOnly, same-site session cookie.
Approve/skip actions execute as authenticated Server Actions and never expose
the webhook secret or Supabase key to the browser.

### Step 4 — Build a sequence and enroll contacts

Unlock the dashboard and use **Sequences** to create or edit cadence and copy.
Then use **Contacts** to upload or paste a CSV, choose the sequence, and enroll
the batch. Imports validate email addresses, de-duplicate the batch, preserve
existing contacts, honor bounced/unsubscribed suppression, and place every new
first touch in the hold queue. Importing never sends email.

Required CSV column: `email`. Supported optional columns include `first_name`,
`last_name`, `company`, `practice_name`, `title`, `phone`, `city`, `state`,
`linkedin_url`, `source`, and the personalization fields documented below.

The command-line flow remains available for automation:

```bash
# Aesthetic campaign — getleads export
node scripts/enroll-contacts.js --sequence dp4 --file contacts.json

# HVAC campaign — Automate305 / South Florida list
node scripts/enroll-contacts.js --sequence hvac_a --file hvac-contacts.json

# Run the daily trigger manually to test
node scripts/daily-trigger.js
```

Contact JSON is one object per lead. HVAC leads may carry per-prospect
personalization used by the ColdIQ copy:

```json
[
  {
    "email": "chris@pacmanhef.com",
    "first_name": "Chris",
    "company": "Pacman HVAC",
    "city": "Fort Lauderdale",
    "linkedin_url": "https://www.linkedin.com/in/chrispacc",
    "source": "clay",
    "personalized_line": "Saw Pacman HVAC covers electric and fire on top of AC. That is a lot to coordinate.",
    "pain_point": "scheduling and dispatch",
    "area": "Broward",
    "website_observation": "A few quick wins could help it convert more visitors into booked jobs."
  }
]
```

Missing personalization fields fall back to safe generic copy, so a bare
`email` + `first_name` + `company` is enough to start. The HVAC prospect list
lives in the [`cold-iq-gtm`](https://github.com/automate305/cold-iq-gtm) repo
under `gtm-outbound/prospects/` and `gtm-outbound/data/` — reshape those rows
into the JSON above before enrolling.

> **A/B split:** send prospects with a weak/no website to `hvac_a` (free-website
> carrot) and those with an established presence to `hvac_b` (ROI angle).

**Converting a raw list to enroll JSON.** `scripts/convert-contacts.js` turns a
prospect CSV — or the `cold-iq-gtm` `state.json` queue (which already carries
per-prospect personalization and A/B assignments) — into enroll-ready files,
split by sequence:

```bash
# From the cold-iq-gtm queue (keeps personalized lines + A/B split):
node scripts/convert-contacts.js --queue ../cold-iq-gtm/gtm-outbound/data/state.json

# From a CSV export (Apollo / getleads / Clay headers); --sequence optional:
node scripts/convert-contacts.js --csv prospects.csv --sequence hvac_a
```

It writes `hvac_a.contacts.json` / `hvac_b.contacts.json` (matched by
`.gitignore`, so lead data never lands in git), strips legal suffixes from
company names, de-dupes by email, and prints the exact `enroll-contacts.js`
commands to run next.

---

## Daily workflow

```
Morning → node scripts/daily-trigger.js
          ↓
          Verifies active SMTP accounts (no email sent)
          ↓
          Resets sender counts
          ↓
          Calls Vercel /api/send
          ↓
          Pulls approved items from today's queue in Supabase
          ↓
          Sends via campaign-matched SMTP (Google or Hostinger)
          ↓
          Updates enrollment step + next_send_date
          ↓
          Prints summary to terminal
```

The trigger processes **every** active campaign in one run; each email draws a
sender from its own campaign pool. A sender must be active, marked `warmed`,
have remaining daily capacity, and have a usable `SMTP_PASS_*` credential.
New enrollments default to `held` for first-touch approval. Approving an item in
the dashboard moves it into the next protected send run; skipping pauses it.

---

## Sender warmup and campaign ramp

Warm each new real mailbox for 2–3 weeks with campaign sending disabled. Once
mailbox health is stable, set `warmed=true`, set `active=true`, and use this
conservative campaign ramp:

| Days | limit per active mailbox | Notes |
|------|--------------------------|-------|
| 1–3  | 5   | Start here |
| 4–7  | 10  | |
| 8–14 | 15  | |
| 15+  | 25  | Full send |

- **Aesthetic / Hostinger** (`aestheticdevicepro.com`): matt@ and tamiko@ are
  the two real mailboxes. They start inactive and blocked from campaign sends
  until warmup is complete. Aliases remain inactive because they are not
  independent mailbox capacity.
- **HVAC / Google Workspace** (`automate305.com`): cam@ is the confirmed warmed
  sender and starts at 5/day. `SMTP_PASS_CAM` must contain a Google App Password.
  camilo@ / hello@ / sales@ stay inactive unless they become real mailboxes and
  complete their own warmup.

### Deliverability before you scale
- Set up **SPF, DKIM, and DMARC** on both sending domains before raising limits.
- Run the protected `/api/readiness` check before enabling campaign sends. It
  authenticates each active positive-limit mailbox without sending a message.
- Every send includes a one-click `List-Unsubscribe` header (RFC 8058) plus a
  plain-text unsubscribe line, and honors replies routed to the main inbox.
- Keep the 3s inter-send throttle (in `pages/api/send.js`) to stay under SMTP limits.

---

## Managing replies / bounces

When you see a reply or bounce in the Google Workspace or Hostinger inbox:

```bash
# Someone replied — stop sequence
curl -X POST https://a305-sep.vercel.app/api/update-status \
  -H "x-a305-secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email": "contact@practice.com", "status": "replied"}'

# Hard bounce
curl -X POST https://a305-sep.vercel.app/api/update-status \
  -d '{"email": "bad@email.com", "status": "bounced"}'

# Unsubscribe request
curl -X POST https://a305-sep.vercel.app/api/update-status \
  -d '{"email": "contact@practice.com", "status": "unsubscribed"}'
```

---

## Sequence cadence

Sequences can be any number of steps; `delay_days` on each template row = days
after the previous step. The engine advances to the next step automatically and
marks the enrollment `completed` when no further step exists.

**Aesthetic** (`dp4`, `clearview`) — 3 steps, 12 days:

| Step | Day | Template |
|------|-----|----------|
| 1    | 0   | Intro / hook |
| 2    | +4  | Follow-up angle |
| 3    | +8  | Breakup / last touch |

**HVAC** (`hvac_a`, `hvac_b`) — 4 email steps, 14 days:

| Step | Day | `hvac_a` (offer-led) | `hvac_b` (ROI angle) |
|------|-----|----------------------|----------------------|
| 1    | 0   | opener               | research drop |
| 2    | +3  | proof                | the numbers |
| 3    | +7  | free website         | peer move |
| 4    | +14 | breakup              | direct ask |

> The ColdIQ HVAC playbook also has LinkedIn and phone touches between emails.
> Those are **manual** and out of scope for this SMTP engine — run them from the
> `cold-iq-gtm` task lists. This SEP handles the email touches only.

---

## API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/send` | POST | Process today's queue |
| `/api/enroll` | POST | Add contacts to a sequence |
| `/api/update-status` | POST | Mark replied/bounced/unsubscribed |
| `/api/health` | GET | Public placeholder-aware config check |
| `/api/readiness` | GET | Protected, no-send SMTP authentication check |

The handlers live under `pages/api/` so their public URLs and request/response
contracts remain unchanged alongside the App Router dashboard.

The mutation endpoints and `/api/readiness` require the `x-a305-secret` header.
`/api/health` is unauthenticated by design and reports booleans only. Values
copied unchanged from `.env.example` are treated as unconfigured.

Run the readiness check only from a trusted terminal. It opens SMTP connections
and authenticates, but it does not send email:

```bash
curl https://a305-sep.vercel.app/api/readiness \
  -H "x-a305-secret: $WEBHOOK_SECRET"
```
