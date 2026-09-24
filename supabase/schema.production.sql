-- ============================================================================
-- OUTBOX · Supabase schema, reverse-engineered from the LIVE database
--
--   project : qpwqqrdxnnvztnuavyvg   (a305-sep)
--   schema  : public
--   captured: 2026-09-09
--
-- This file records what production actually contains, measured from
-- pg_catalog. It replaces the committed supabase/schema.sql, which had drifted
-- from reality in both directions:
--
--   * the committed file declares 19 tables (brands, mailboxes, campaigns,
--     send_queue, global_blocklist, brand_suppressions, dns_check_results,
--     audit_log, ...) that DO NOT EXIST here;
--   * the live database has columns the committed file never declares —
--     senders.health_score and its five sub-scores, senders.warmup_started_at,
--     enrollments.hold_reason / held_at / reviewed_at / reviewed_by,
--     contacts.unsubscribed / bounced;
--   * the committed file declares contacts.tags, which does not exist here.
--
-- Idempotent and additive: safe to run against the live database. It creates
-- nothing that exists and drops nothing at all.
--
-- SECURITY NOTE — do not "fix" this by adding policies.
-- RLS is enabled on every table with ZERO policies, which denies anon and
-- authenticated entirely and leaves service_role (which bypasses RLS) as the
-- only accessor. That is deliberate and correct for a server-only app. The
-- committed schema.sql would have added `for all using (true)` policies, which
-- is strictly weaker. Applying it would be a regression.
-- ============================================================================


-- ── CONTACTS ────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id                     uuid primary key default gen_random_uuid(),
  email                  text not null unique,
  first_name             text,
  last_name              text,
  practice_name          text,
  company                text,
  title                  text,
  phone                  text,
  city                   text,
  state                  text default 'FL'::text,
  linkedin_url           text,
  source                 text,
  personalized_line      text,
  personalized_paragraph text,
  pain_point             text,
  area                   text,
  website_observation    text,
  -- Suppression flags. These two are the live send gate: todays_queue filters
  -- on them. Nothing else enforces suppression today.
  unsubscribed           boolean not null default false,
  bounced                boolean not null default false,
  created_at             timestamptz default now()
);


-- ── SENDERS ─────────────────────────────────────────────────────────────────
-- One row per sending mailbox. `campaign` is the brand key ('hvac' |
-- 'aesthetic'); there is no separate brands table in production.
create table if not exists senders (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null unique,
  name                  text not null,
  host                  text not null default 'smtp.hostinger.com'::text,
  port                  integer not null default 465,
  campaign              text,
  signature             text,
  reply_to              text,
  daily_limit           integer not null default 5,
  sends_today           integer not null default 0,
  warmed                boolean not null default false,
  active                boolean not null default true,
  created_at            timestamptz default now(),
  warmup_started_at     timestamptz,
  health_score          integer,
  inbox_placement_score integer,
  bounce_score          integer,
  complaint_score       integer,
  postmaster_score      integer,
  reply_score           integer
);


-- ── SEQUENCES ───────────────────────────────────────────────────────────────
-- `name` is the SYSTEM KEY and automation depends on it. Live values:
--   hvac_a, hvac_b            (campaign = 'hvac')
--   clearview, clearview_b    (campaign = 'aesthetic')
--   dp4, dp4_b                (campaign = 'aesthetic')
-- Display names belong in the UI layer. Do not rename these.
create table if not exists sequences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  campaign    text not null default 'general'::text,
  description text,
  active      boolean not null default true,
  created_at  timestamptz default now()
);


-- ── TEMPLATES ───────────────────────────────────────────────────────────────
create table if not exists templates (
  id          uuid primary key default gen_random_uuid(),
  sequence_id uuid references sequences(id) on delete cascade,
  step        integer not null,
  subject     text not null,
  body_text   text not null,
  body_html   text,
  delay_days  integer not null default 0,
  created_at  timestamptz default now(),
  unique (sequence_id, step)
);


-- ── ENROLLMENTS ─────────────────────────────────────────────────────────────
-- The approval/hold columns below are load-bearing. All 337 production
-- enrollments sit in status 'held', and that is currently the only thing
-- preventing Aesthetic Device Pro from sending. Do not migrate them.
create table if not exists enrollments (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid references contacts(id) on delete cascade,
  sequence_id    uuid references sequences(id) on delete cascade,
  current_step   integer not null default 1,
  next_send_date date not null default current_date,
  status         text not null default 'active'::text,
  enrolled_at    timestamptz default now(),
  completed_at   timestamptz,
  hold_reason    text,
  held_at        timestamptz,
  reviewed_at    timestamptz,
  reviewed_by    text,
  unique (contact_id, sequence_id)
);

create index if not exists enrollments_sequence_id_idx on enrollments (sequence_id);


-- ── SEND LOG ────────────────────────────────────────────────────────────────
-- status values observed in production: 'warmup'. The default is 'sent'.
-- All 24 live rows are warmup sends, not campaign sends.
create table if not exists send_log (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid references enrollments(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete cascade,
  sender_id     uuid references senders(id),
  template_id   uuid references templates(id),
  step          integer not null,
  subject       text,
  status        text not null default 'sent'::text,
  sent_at       timestamptz default now(),
  error_message text
);

create index if not exists send_log_contact_id_idx    on send_log (contact_id);
create index if not exists send_log_enrollment_id_idx on send_log (enrollment_id);
create index if not exists send_log_sender_id_idx     on send_log (sender_id);
create index if not exists send_log_template_id_idx   on send_log (template_id);


-- ── AI USAGE ────────────────────────────────────────────────────────────────
create table if not exists ai_usage (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  model         text not null,
  feature       text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(12,6) not null default 0,
  created_at    timestamptz not null default now()
);


-- ── MINTIQ MEMOS ────────────────────────────────────────────────────────────
-- Belongs to the MintIQ side project, not to OUTBOX sending. Recorded here
-- only because it shares the schema.
create table if not exists mintiq_memos (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  business_name text not null,
  source        text not null check (source in ('ui','webhook','sample')),
  intake        jsonb not null,
  memo          jsonb not null,
  stats         jsonb,
  delivered_to  text,
  created_at    timestamptz not null default now()
);

create index if not exists mintiq_memos_business_name_idx on mintiq_memos (lower(business_name));
create index if not exists mintiq_memos_created_at_idx    on mintiq_memos (created_at desc);


-- ── VIEWS ───────────────────────────────────────────────────────────────────
-- All three are security_invoker, so they honour the caller's RLS rather than
-- running as their owner. Keep it that way.

-- The live suppression gate. Unsubscribed and bounced contacts are excluded
-- HERE, not in application code. Extend this view; do not replace it.
create or replace view todays_queue
with (security_invoker = true) as
select
  e.id                     as enrollment_id,
  c.email,
  c.first_name,
  c.last_name,
  c.practice_name,
  c.phone,
  e.current_step           as step,
  e.sequence_id,
  seq.name                 as sequence_name,
  t.subject,
  t.body_text,
  t.delay_days,
  c.id                     as contact_id,
  seq.campaign,
  c.company,
  c.personalized_line,
  c.personalized_paragraph,
  c.pain_point,
  c.area,
  c.city,
  c.website_observation,
  e.next_send_date
from enrollments e
join contacts  c   on c.id  = e.contact_id
join sequences seq on seq.id = e.sequence_id
join templates t   on t.sequence_id = e.sequence_id and t.step = e.current_step
where e.status         = 'active'
  and e.next_send_date <= current_date
  and c.unsubscribed   = false
  and c.bounced        = false
order by e.next_send_date;

-- NOTE: this view DOES enforce warmed = true and daily_limit > 0. The
-- committed api/send.js does not use it — pickSender() queries the senders
-- table directly and filters only on active + campaign + daily limit. Whether
-- the deployed build uses this view or that query is unknown until the
-- production source is recovered. That is the open question in Phase 1.
create or replace view available_senders
with (security_invoker = true) as
select
  id, email, name, host, port, campaign, signature, reply_to,
  daily_limit, sends_today, warmed, active, created_at, warmup_started_at,
  health_score, inbox_placement_score, bounce_score, complaint_score,
  postmaster_score, reply_score
from senders
where active      = true
  and warmed      = true
  and daily_limit > 0
  and sends_today < daily_limit
order by sends_today;

create or replace view pipeline_summary
with (security_invoker = true) as
select
  seq.name  as sequence,
  count(*) filter (where e.status = 'active')       as active,
  count(*) filter (where e.status = 'completed')    as completed,
  count(*) filter (where e.status = 'replied')      as replied,
  count(*) filter (where e.status = 'unsubscribed') as unsubscribed,
  count(*) filter (where e.status = 'bounced')      as bounced,
  count(*)                                          as total,
  seq.campaign
from enrollments e
join sequences seq on seq.id = e.sequence_id
group by seq.name, seq.campaign;


-- ── ROW LEVEL SECURITY ──────────────────────────────────────────────────────
-- Enabled everywhere, with no policies, on purpose. See the header note.
alter table contacts     enable row level security;
alter table senders      enable row level security;
alter table sequences    enable row level security;
alter table templates    enable row level security;
alter table enrollments  enable row level security;
alter table send_log     enable row level security;
alter table ai_usage     enable row level security;
alter table mintiq_memos enable row level security;
