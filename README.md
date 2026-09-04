# Automate305 SEP
**Simple Sales Engagement Platform**
Supabase (state) + Hostinger SMTP (sending) + Vercel (webhook) + Cowork (trigger)

Runs **multiple campaigns from one engine**, each with its own senders and copy:

| Campaign | Sequences | Sends from | Copy |
|----------|-----------|------------|------|
| `aesthetic` | `dp4`, `clearview` | `aestheticdevicepro.com` (matt@ / tamiko@ + aliases) | Device outreach |
| `hvac` | `hvac_a`, `hvac_b` | `automate305.com` (cam@ + warmup slots) | Automate305 HVAC / South Florida (ColdIQ copy) |

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
cp .env.example .env
# Fill in your .env values
```

### Step 4 — Enroll your first contacts
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
          Resets sender counts
          ↓
          Calls Vercel /api/send
          ↓
          Pulls today's queue from Supabase
          ↓
          Sends via Hostinger SMTP (campaign-matched sender)
          ↓
          Updates enrollment step + next_send_date
          ↓
          Prints summary to terminal
```

The trigger processes **every** active campaign in one run; each email draws a
sender from its own campaign pool.

---

## Sender warmup schedule

Update `daily_limit` in the Supabase `senders` table as you warm up. Warm each
domain independently:

| Days | limit per active mailbox | Notes |
|------|--------------------------|-------|
| 1–3  | 5   | Start here |
| 4–7  | 10  | |
| 8–14 | 15  | |
| 15+  | 25  | Full send |

- **Aesthetic** (`aestheticdevicepro.com`): matt@ and tamiko@ start active at 5.
  Activate an alias (don@, jen@, …) by raising its `daily_limit` above 0.
- **HVAC** (`automate305.com`): cam@ starts active at 5. camilo@ / hello@ / sales@
  are warmup slots — create the real Hostinger mailbox, add its `SMTP_PASS_*`
  env var, then set `active=true` and raise `daily_limit`.

### Deliverability before you scale
- Set up **SPF, DKIM, and DMARC** on both sending domains before raising limits.
- Every send includes a one-click `List-Unsubscribe` header (RFC 8058) plus a
  plain-text unsubscribe line, and honors replies routed to the main inbox.
- Keep the 3s inter-send throttle (in `api/send.js`) to stay under SMTP limits.

---

## Managing replies / bounces

When you see a reply or bounce in Hostinger inbox:

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
| `/api/health` | GET | Config/health check (which env vars are set) |
| `/api/dashboard` | GET | Read-only aggregate data for the operator dashboard |

The POST endpoints and `/api/dashboard` require the `x-a305-secret` header
(`/api/dashboard` accepts `DASHBOARD_PASSWORD` if set, else `WEBHOOK_SECRET`).
`/api/health` is unauthenticated by design — it reports only which env vars
are *set* (booleans, never values), so it's useful for debugging the very
secret that would otherwise gate it.

---

## Design system

The visual language for the dashboard and every future Automate305 surface is
specified in [`docs/A305-DESIGN-SYSTEM-PRD.md`](docs/A305-DESIGN-SYSTEM-PRD.md):
tokens, components, personas, screen templates, and the full status matrix.
Start there before wireframing a new screen.

## Operator dashboard

`/dashboard.html` is a lightweight command center for watching the engine —
open it in a browser and enter your dashboard key (the value of
`DASHBOARD_PASSWORD`, or `WEBHOOK_SECRET` if that's unset).

It shows, live from Supabase:
- **KPIs** — sent today, queued today, active / replied / completed, contacts, unsubscribes, bounces
- **Pipeline by sequence** — per-sequence funnel across both campaigns
- **Senders & warmup** — each mailbox's `sends_today / daily_limit` with a warmup bar, grouped by campaign
- **Today's queue** — who is scheduled to go out today
- **Recent activity** — the latest sends and their status

All Supabase access is server-side (`/api/dashboard` uses the service key); the
browser only ever receives aggregated JSON — no secrets, no service key. The key
you type is kept in that browser's `localStorage` only.
