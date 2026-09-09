# Phase 0 — production source recovery and reconciliation

Status: **partially complete.** The database half is done and committed. The
application-source half is blocked on one manual step, described under
"What is still missing" below.

Nothing in this branch changes sending behaviour, DNS, data, or production
configuration. It is a record and a schema file. No migration has been run.

---

## Why this branch exists

`outbox.automate305.com` is served by a deployment that does not correspond to
any commit in this repository:

| Deployment fact | Value |
| --- | --- |
| Deployment | `dpl_5ZKmAySLTFsd5EhvMXGuagyh1bo6` |
| Project | `a305-outbound-engine` (`prj_Jn89hpBvOhY6vbdYOwC5KkFn4ctP`) |
| Built | 5 Sep 2026, 16:27–16:28 UTC |
| Source | `cli` — not a git-triggered deploy |
| `gitDirty` | `1` — **uncommitted working-tree changes were included** |
| Referenced ref | `feat/a305-sep-dashboard` — **no longer on the remote** |
| Referenced commit | `0df6cfe` (27 Aug) |
| Actor | `codex` |

The referenced commit contains 13 files of plain serverless JavaScript with no
dashboard. The thing actually serving traffic is a Next.js 16.2.6 App Router
application with seven pages. They are not the same program. Because the build
was made from a dirty tree and the branch was deleted, **the exact production
source does not exist in git and cannot be reconstructed from it.**

Until that is resolved, any change committed here targets a codebase that is
not production, and deploying it would silently replace whatever is live.

---

## What production actually contains

Recovered from the deployment's build log — this is the authoritative route
manifest for the running application.

### App Router pages

```
ƒ /                     dashboard (key-gated lock screen)
○ /_not-found
ƒ /activity
ƒ /approvals
ƒ /contacts
ƒ /infrastructure
ƒ /pipeline
ƒ /sequences
○ /icon.png  ○ /apple-icon.png  ○ /opengraph-image  ○ /manifest.webmanifest
```

Worth noting: the six operator pages the migration brief asks for — Contacts,
Sequences, Pipeline, Approvals, Infrastructure, Activity — **already exist in
production.** The brief was written as though they did not.

### Pages Router API routes

```
ƒ /api/cron/daily-send
ƒ /api/enroll
ƒ /api/health
ƒ /api/readiness
ƒ /api/send
ƒ /api/update-status
```

`/api/readiness` also has no counterpart in this repository.

### Build environment

| | |
| --- | --- |
| Framework | Next.js 16.2.6, `next build --webpack` |
| Package | `a305-sep@1.0.0` |
| Node | `engines: >=22.13.0` |
| Deployment files uploaded | 54 |
| Notable dependencies | `esbuild@0.27.0`, `sharp@0.34.5` |
| Build id | `mC4Sbm0GAOCPU7IH-WFdl` |

### Live endpoint behaviour (read-only probes)

`GET /api/health` — unauthenticated, returns presence booleans only, no values:

```json
{"status":"ok","service":"a305-sep","ready":true,
 "env":{"supabase_url":true,"supabase_service_key":true,
        "webhook_secret":true,"webhook_url":true,"smtp_pass_cam":true}}
```

`GET /api/readiness` — returns `401 Unauthorized` without a secret. Correct.
Not probed further.

Note that the health check knows about exactly one SMTP credential,
`smtp_pass_cam`. It has no visibility into the Hostinger senders used by
Aesthetic Device Pro. That is not evidence those credentials are absent — the
check simply predates them — but it does mean production currently has **no
readiness signal for the Aesthetic mailboxes at all.** Phase 1 should fix that.

---

## Database reconciliation — complete

`supabase/schema.production.sql` is new in this branch. It was reverse-engineered
from `pg_catalog` on the live database (project `qpwqqrdxnnvztnuavyvg`,
schema `public`) on 9 Sep 2026, and it records what production actually contains.

**Verified, not asserted.** The file was applied twice to a scratch PostgreSQL 16
database — clean the first time, only "already exists, skipping" notices the
second, so it is genuinely idempotent. The resulting column signature was then
compared against the live database:

```
signature = md5(string_agg(table|column|type|notnull|default, E'\n' ordered))

  scratch db from this file   7b7f107474ade93550601918b985cbb5   93 columns
  live production database    7b7f107474ade93550601918b985cbb5   93 columns
```

Identical. Applying this file to an empty database reproduces production's
structure exactly: 8 tables, 3 `security_invoker` views, RLS enabled on every
table, 0 policies.

The committed `supabase/schema.sql` had drifted from reality **in both
directions**:

| | Committed `schema.sql` | Live database |
| --- | --- | --- |
| Tables | 19 | 8 |
| `brands`, `mailboxes`, `campaigns`, `sequence_steps`, `send_queue`, `global_blocklist`, `brand_suppressions`, `inbound_messages`, `voice_profiles`, `content_sources`, `health_score_history`, `dns_check_results`, `ai_cost_log`, `global_settings` | declared | **do not exist** |
| `senders` table | not declared (uses `mailboxes`) | exists, 20 columns |
| `senders.health_score` + 5 sub-scores | not declared | exist |
| `senders.warmup_started_at` | not declared | exists |
| `enrollments.hold_reason`, `held_at`, `reviewed_at`, `reviewed_by` | not declared | exist, in active use |
| `contacts.unsubscribed`, `contacts.bounced` | not declared | exist, and are the live send gate |
| `contacts.tags` | declared | **does not exist** |

### Do not apply the old schema file

`supabase/schema.sql` would create `for all using (true)` RLS policies. The live
database has RLS **enabled on all eight tables with zero policies**, which denies
`anon` and `authenticated` outright and leaves `service_role` — which bypasses
RLS — as the only accessor. All three views are `security_invoker = true`, so
they honour the caller's RLS rather than running as owner.

The live posture is strictly stronger. Applying the committed file would be a
security regression, not a fix.

### One correction to the migration audit

The audit originally stated that the `available_senders` view does not enforce
`warmed`. That was read from the committed schema and is wrong for production.
The live view is:

```sql
where active = true and warmed = true and daily_limit > 0 and sends_today < daily_limit
```

It does enforce `warmed`, and `daily_limit > 0` alone would exclude every
dormant Aesthetic mailbox. The committed `pickSender()` in `api/send.js` does
**not** — it queries the `senders` table directly and filters only on `active`,
campaign and the daily limit.

So there are two candidate paths and they disagree. **Which one the deployed
build calls is unknown until the source is recovered.** This is the single most
important thing Phase 0 unblocks, because Phase 1 depends on the answer.

### Live data state at time of audit

337 contacts · 337 enrollments, **all `held`**, 150 reviewed · 24 `send_log`
rows, **all `status = 'warmup'`** · 16 senders (hvac: 4, one active and warmed;
aesthetic: 12, two active and none warmed) · 14 templates · 6 sequences ·
0 unsubscribed · 0 bounced.

No Aesthetic campaign mail has been sent. The 24 rows are warmup traffic, which
is what warming is. The block currently rests on the held enrollments.

---

## What is still missing

The application source. One manual step, because the Vercel Source tab is a
browser view behind an authenticated session and cannot be fetched by API:

1. Open <https://vercel.com/deployments/a305-outbound-engine-bxbnshyuv-cam-automate305.vercel.app/source>
2. Download the 54 deployment files.
3. Commit them to this branch.

Alternatively, if the machine the 5 Sep deploy was run from still has the
working tree, push that instead — it is the exact source, whereas the Source
tab is the uploaded set.

### Verification once the source lands

- [ ] `package.json` declares Next.js `16.2.6` and `engines.node >= 22.13.0`.
- [ ] The tree produces exactly the routes listed above — seven app pages and six API routes.
- [ ] A build from the committed tree yields a bundle matching the production build.
- [ ] `pickSender()` (or whatever replaced it) is read and the `warmed` question is answered definitively.
- [ ] The Vercel project is re-linked to git so CLI deploys from a dirty tree stop being possible.
- [ ] Production still serves the lock screen. No behaviour change.

---

*Recorded 9 Sep 2026. Read-only investigation: no migration applied, no DNS
touched, no production configuration altered.*
