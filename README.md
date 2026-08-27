# Automate305 SEP
**Simple Sales Engagement Platform**
Supabase (state) + Hostinger SMTP (sending) + Vercel (webhook) + Cowork (trigger)

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
# Create a contacts.json with your getleads export
node scripts/enroll-contacts.js --sequence dp4 --file contacts.json

# Run the daily trigger manually to test
node scripts/daily-trigger.js
```

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
          Sends via Hostinger SMTP (matt@ or tamiko@)
          ↓
          Updates enrollment step + next_send_date
          ↓
          Prints summary to terminal
```

---

## Sender warmup schedule

Update `daily_limit` in Supabase `senders` table as you warm up:

| Days | matt@ limit | tamiko@ limit | Notes |
|------|-------------|---------------|-------|
| 1–3  | 5           | 5             | Start here |
| 4–7  | 10          | 10            | |
| 8–14 | 15          | 15            | |
| 15+  | 25          | 25            | Full send |

To activate aliases (don@, jen@, etc.) update `daily_limit` from 0 and `active` to true in Supabase.

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

| Step | Day | Template |
|------|-----|----------|
| 1    | 0   | Intro / hook |
| 2    | +4  | Follow-up angle |
| 3    | +8  | Breakup / last touch |

Total sequence duration: 12 days per contact.

---

## API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/send` | POST | Process today's queue |
| `/api/enroll` | POST | Add contacts to a sequence |
| `/api/update-status` | POST | Mark replied/bounced/unsubscribed |

All endpoints require `x-a305-secret` header.
