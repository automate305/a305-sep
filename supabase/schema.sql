-- ============================================================
-- Automate305 SEP · Supabase Schema
-- Run this in your Supabase SQL Editor (supabase.com/dashboard)
--
-- Multi-campaign engine. Two campaigns ship seeded:
--   • aesthetic  → DP4 / ClearVIEW device outreach   (aestheticdevicepro.com)
--   • hvac       → Automate305 HVAC / South Florida   (automate305.com)
-- Senders are routed by campaign so HVAC mail never goes out from the
-- aesthetic mailboxes (and vice versa).
--
-- This script is idempotent: safe to re-run on an existing project. New
-- columns are added with `alter table ... add column if not exists`.
-- ============================================================

-- ── SENDERS ──────────────────────────────────────────────────
create table if not exists senders (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  host        text not null default 'smtp.hostinger.com',
  port        int  not null default 465,
  campaign    text,           -- 'aesthetic' | 'hvac'
  signature   text,           -- signature block used for {{signature}}
  reply_to    text,           -- where replies route (aliases → main inbox)
  daily_limit int  not null default 5,   -- starts low, increase as warmed
  sends_today int  not null default 0,
  warmed      boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

-- Columns added after the original scaffold (no-op on a fresh create)
alter table senders add column if not exists signature text;
alter table senders add column if not exists reply_to  text;

-- Seed: aesthetic senders (aestheticdevicepro.com) — matt@ and tamiko@ groups.
-- Aliases start inactive (daily_limit 0); replies route to the main inbox.
insert into senders (email, name, campaign, signature, reply_to, daily_limit) values
  ('matt@aestheticdevicepro.com',    'Matt',    'aesthetic', 'Matt',    'matt@aestheticdevicepro.com',   5),
  ('don@aestheticdevicepro.com',     'Don',     'aesthetic', 'Don',     'matt@aestheticdevicepro.com',   0),
  ('ed@aestheticdevicepro.com',      'Ed',      'aesthetic', 'Ed',      'matt@aestheticdevicepro.com',   0),
  ('eddie@aestheticdevicepro.com',   'Eddie',   'aesthetic', 'Eddie',   'matt@aestheticdevicepro.com',   0),
  ('matthew@aestheticdevicepro.com', 'Matthew', 'aesthetic', 'Matthew', 'matt@aestheticdevicepro.com',   0),
  ('rob@aestheticdevicepro.com',     'Rob',     'aesthetic', 'Rob',     'matt@aestheticdevicepro.com',   0),
  ('tamiko@aestheticdevicepro.com',  'Tamiko',  'aesthetic', 'Tamiko',  'tamiko@aestheticdevicepro.com', 5),
  ('jen@aestheticdevicepro.com',     'Jen',     'aesthetic', 'Jen',     'tamiko@aestheticdevicepro.com', 0),
  ('jenny@aestheticdevicepro.com',   'Jenny',   'aesthetic', 'Jenny',   'tamiko@aestheticdevicepro.com', 0),
  ('jess@aestheticdevicepro.com',    'Jess',    'aesthetic', 'Jess',    'tamiko@aestheticdevicepro.com', 0),
  ('jessica@aestheticdevicepro.com', 'Jessica', 'aesthetic', 'Jessica', 'tamiko@aestheticdevicepro.com', 0),
  ('tami@aestheticdevicepro.com',    'Tami',    'aesthetic', 'Tami',    'tamiko@aestheticdevicepro.com', 0)
on conflict (email) do nothing;

-- Seed: HVAC senders (automate305.com). cam@ is the live sender; the rest are
-- warmup slots — create the real Hostinger mailbox, warm it, then flip
-- active=true and raise daily_limit. Replies route to cam@.
insert into senders (email, name, campaign, signature, reply_to, daily_limit, active) values
  ('cam@automate305.com',    'Camilo', 'hvac', 'Camilo | Automate305', 'cam@automate305.com', 5, true),
  ('camilo@automate305.com', 'Camilo', 'hvac', 'Camilo | Automate305', 'cam@automate305.com', 0, false),
  ('hello@automate305.com',  'Camilo', 'hvac', 'Camilo | Automate305', 'cam@automate305.com', 0, false),
  ('sales@automate305.com',  'Camilo', 'hvac', 'Camilo | Automate305', 'cam@automate305.com', 0, false)
on conflict (email) do nothing;

-- ── SEQUENCES ────────────────────────────────────────────────
create table if not exists sequences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,   -- 'dp4' | 'clearview' | 'hvac_a' | 'hvac_b'
  campaign    text not null default 'general',  -- routes to senders.campaign
  description text,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

alter table sequences add column if not exists campaign text not null default 'general';

insert into sequences (name, campaign, description) values
  ('dp4',       'aesthetic', 'DP4 Microneedling device outreach · 3-step · aesthetics practices'),
  ('clearview', 'aesthetic', 'ClearVIEW device outreach · 3-step · aesthetics practices'),
  ('hvac_a',    'hvac',      'HVAC Sequence A · 4-step · offer-led (free website carrot) · weak/no website'),
  ('hvac_b',    'hvac',      'HVAC Sequence B · 4-step · ROI/operator angle · established presence')
on conflict (name) do update set campaign = excluded.campaign;

-- ── TEMPLATES ────────────────────────────────────────────────
-- One row per step per sequence. delay_days = days after the PREVIOUS step.
create table if not exists templates (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid references sequences(id) on delete cascade,
  step         int  not null,        -- 1-based
  subject      text not null,
  body_text    text not null,        -- plain text (primary)
  body_html    text,                 -- optional HTML version
  delay_days   int  not null default 0,  -- days after previous step
  created_at   timestamptz default now(),
  unique (sequence_id, step)
);

-- ── DP4 templates (aesthetic) ────────────────────────────────
insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 1,
  'Quick question about your device lineup, {{first_name}}',
  'Hi {{first_name}},

I came across {{practice_name}} and wanted to reach out about a device that''s been getting strong adoption in practices like yours — the DP4 Microneedling system.

Practices are seeing measurable retention improvements (clients coming back specifically for it) and it adds a high-margin service without a long learning curve.

Worth a 10-minute call this week to see if it''s a fit?

Best,
{{sender_name}}',
  0
from sequences s where s.name = 'dp4'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 2,
  'Re: DP4 — one thing I forgot to mention',
  'Hi {{first_name}},

Following up from my note earlier this week.

One thing I didn''t mention — there''s a trade-in program running right now and a 14-day trial period. So there''s no risk to seeing it in your space before committing.

Still worth 10 minutes?

{{sender_name}}',
  4
from sequences s where s.name = 'dp4'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 3,
  'Closing the loop, {{first_name}}',
  'Hi {{first_name}},

Last note from me — I don''t want to keep reaching out if the timing isn''t right.

If you''d like to revisit the DP4 down the road, just reply and I''ll pick it back up. Happy to send a one-pager in the meantime if useful.

Either way, best of luck with {{practice_name}}.

{{sender_name}}',
  8
from sequences s where s.name = 'dp4'
on conflict (sequence_id, step) do nothing;

-- ── ClearVIEW templates (aesthetic) ──────────────────────────
insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 1,
  '94% retention — the number that caught my eye, {{first_name}}',
  'Hi {{first_name}},

I''ll keep this short — I work with a device called ClearVIEW that''s showing a 94% patient retention rate across practices using it.

Dr. Croley (who you may know in the space) has been one of the vocal advocates. The results have been consistent enough that I wanted to bring it to {{practice_name}}''s attention.

Open to a quick call?

{{sender_name}}',
  0
from sequences s where s.name = 'clearview'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 2,
  'Re: ClearVIEW — following up',
  'Hi {{first_name}},

Just circling back on my last note about ClearVIEW.

The 94% retention stat tends to get attention because most practices struggle with exactly that — getting clients to come back consistently. This device makes the next appointment a natural conversation.

Worth 15 minutes to walk through the numbers?

{{sender_name}}',
  4
from sequences s where s.name = 'clearview'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 3,
  'Last note — ClearVIEW',
  'Hi {{first_name}},

Not going to keep following up after this — just wanted to leave the door open.

If ClearVIEW becomes relevant for {{practice_name}} later, reply anytime and I''ll get you current info.

Take care,
{{sender_name}}',
  8
from sequences s where s.name = 'clearview'
on conflict (sequence_id, step) do nothing;

-- ── HVAC Sequence A (offer-led) ──────────────────────────────
-- Copy ported from cold-iq-gtm/gtm-outbound/copy/email-sequence.md
-- Cadence: day 0 / 3 / 7 / 14  →  delay_days 0 / 3 / 4 / 7
-- Note: no em dashes in HVAC copy (ColdIQ house style).
insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 1,
  '{{company}} - quick question',
  'Hey {{first_name}},

{{personalized_line}}

I work with HVAC companies in the Miami area to automate the back-office stuff that eats up your day. Scheduling, dispatch, follow-ups, invoicing. So you can focus on jobs, not paperwork.

Would a 15-minute call this week make sense to see if there''s a fit?

{{signature}}',
  0
from sequences s where s.name = 'hvac_a'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 2,
  'Re: {{company}} - quick question',
  '{{first_name}},

Most HVAC companies I talk to are losing 20-30% of inbound leads because they can''t respond fast enough. Calls go to voicemail, web forms sit for hours.

One shop I worked with went from missing half their calls to booking 90% within 2 minutes, just by automating the intake.

Worth a quick conversation?

{{signature}}',
  3
from sequences s where s.name = 'hvac_a'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 3,
  'free website for {{company}}',
  '{{first_name}},

I took a look at {{company}}''s online presence. {{website_observation}}

I''m offering a handful of HVAC companies in the area a completely free website rebuild. No strings, no catch. I use it as a portfolio piece, you get a site that actually converts visitors into booked jobs.

If that sounds interesting, happy to show you what it''d look like.

{{signature}}',
  4
from sequences s where s.name = 'hvac_a'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 4,
  'closing the loop',
  '{{first_name}},

I''ve reached out a few times and haven''t heard back. Totally get it, you''re busy running jobs.

I''ll leave the door open: if you ever want to explore automating your scheduling, dispatch, or customer follow-ups, I''m a message away. The free website offer stands too.

Either way, hope {{company}} has a strong season.

{{signature}}',
  7
from sequences s where s.name = 'hvac_a'
on conflict (sequence_id, step) do nothing;

-- ── HVAC Sequence B (ROI / operator angle) ───────────────────
-- Copy ported from cold-iq-gtm/gtm-outbound/copy/email-sequence-b.md
insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 1,
  '{{first_name}}, quick question about {{company}}',
  'Hey {{first_name}},

{{personalized_paragraph}}

I''m curious, how are you handling {{pain_point}} right now? Most HVAC owners I talk to in the {{area}} area are still doing it manually, and it''s costing them 10-15 hours a week.

Happy to share what''s working for other shops if you''re open to a quick call.

{{signature}}',
  0
from sequences s where s.name = 'hvac_b'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 2,
  'Re: {{first_name}}, quick question about {{company}}',
  '{{first_name}},

Ran some rough numbers on what manual ops typically cost an HVAC shop your size:

- Missed calls to 3-5 lost jobs/week at $300-500 avg ticket = $4,500-10,000/month left on the table
- Slow follow-up to 40% of leads go cold after 5 minutes without a response
- Manual scheduling to 2-3 hours/day of admin instead of revenue-generating work

Not saying that''s you, but if any of those hit close, it''s worth a 15-minute conversation.

{{signature}}',
  3
from sequences s where s.name = 'hvac_b'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 3,
  'what other {{area}} HVAC shops are doing',
  '{{first_name}},

Without naming names, a few HVAC companies in {{area}} have started automating their intake, dispatch, and follow-ups. The ones that moved first are pulling ahead because:

- Leads get a text back in under 60 seconds (before the homeowner calls the next company on Google)
- Techs get dispatch updates on their phone instead of calling the office
- Invoices go out same-day, every time

I help shops set this up. No long contracts, no bloated software. Just the pieces that actually move the needle.

Worth a conversation?

{{signature}}',
  4
from sequences s where s.name = 'hvac_b'
on conflict (sequence_id, step) do nothing;

insert into templates (sequence_id, step, subject, body_text, delay_days)
select s.id, 4,
  '15 min, {{first_name}}?',
  '{{first_name}},

I''ll keep this one short. I''ve got a few openings this week for a quick audit call.

I''ll look at your current setup (scheduling, lead response, follow-ups) and tell you exactly where you''re leaving money on the table. No cost, no pitch. Just a diagnostic.

If it''s not useful, you''ll know in the first 5 minutes and we''ll part ways.

{{first_name}}, just reply with a time that works and I''ll send an invite.

{{signature}}',
  7
from sequences s where s.name = 'hvac_b'
on conflict (sequence_id, step) do nothing;

-- ── CONTACTS ─────────────────────────────────────────────────
create table if not exists contacts (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  first_name     text,
  last_name      text,
  practice_name  text,           -- aesthetic campaign
  company        text,           -- hvac campaign (legal suffix stripped)
  title          text,
  phone          text,
  city           text,
  state          text default 'FL',
  linkedin_url   text,
  source         text,           -- 'getleads' | 'apollo' | 'clay' | 'manual'
  -- per-prospect personalization (ColdIQ copy variables)
  personalized_line      text,
  personalized_paragraph text,
  pain_point             text,
  area                   text,
  website_observation    text,
  unsubscribed   boolean not null default false,
  bounced        boolean not null default false,
  created_at     timestamptz default now()
);

-- Columns added after the original scaffold (no-op on a fresh create)
alter table contacts add column if not exists company                text;
alter table contacts add column if not exists linkedin_url           text;
alter table contacts add column if not exists personalized_line      text;
alter table contacts add column if not exists personalized_paragraph text;
alter table contacts add column if not exists pain_point             text;
alter table contacts add column if not exists area                   text;
alter table contacts add column if not exists website_observation    text;

-- ── ENROLLMENTS ──────────────────────────────────────────────
-- One row per contact per sequence. Tracks exactly where they are.
create table if not exists enrollments (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contacts(id) on delete cascade,
  sequence_id     uuid references sequences(id) on delete cascade,
  current_step    int  not null default 1,
  next_send_date  date not null default current_date,
  status          text not null default 'active',
  -- 'active' | 'completed' | 'replied' | 'unsubscribed' | 'bounced' | 'paused'
  enrolled_at     timestamptz default now(),
  completed_at    timestamptz,
  unique (contact_id, sequence_id)
);

-- ── SEND LOG ─────────────────────────────────────────────────
create table if not exists send_log (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid references enrollments(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete cascade,
  sender_id     uuid references senders(id),
  template_id   uuid references templates(id),
  step          int  not null,
  subject       text,
  status        text not null default 'sent',
  -- 'sent' | 'bounced' | 'failed' | 'opened' | 'replied'
  sent_at       timestamptz default now(),
  error_message text
);

-- ── DAILY RESET FUNCTION ─────────────────────────────────────
-- Call this via a Supabase cron job or your webhook at midnight
create or replace function reset_daily_sends()
returns void language sql as $$
  update senders set sends_today = 0;
$$;

-- ── USEFUL VIEWS ─────────────────────────────────────────────

-- What needs to go out today. New columns are appended at the end so this
-- view can be replaced in place on an existing project.
create or replace view todays_queue as
select
  e.id           as enrollment_id,
  c.email,
  c.first_name,
  c.last_name,
  c.practice_name,
  c.phone,
  e.current_step as step,
  e.sequence_id,
  seq.name       as sequence_name,
  t.subject,
  t.body_text,
  t.delay_days,
  -- appended columns:
  c.id           as contact_id,
  seq.campaign   as campaign,
  c.company,
  c.personalized_line,
  c.personalized_paragraph,
  c.pain_point,
  c.area,
  c.city,
  c.website_observation
from enrollments e
join contacts    c   on c.id  = e.contact_id
join sequences   seq on seq.id = e.sequence_id
join templates   t   on t.sequence_id = e.sequence_id and t.step = e.current_step
where e.status         = 'active'
  and e.next_send_date <= current_date
  and c.unsubscribed   = false
  and c.bounced        = false
order by e.next_send_date asc;

-- Sender availability today (send.js additionally filters by campaign)
create or replace view available_senders as
select *
from senders
where active = true
  and sends_today < daily_limit
order by sends_today asc;

-- Pipeline summary
create or replace view pipeline_summary as
select
  seq.name                                          as sequence,
  count(*) filter (where e.status = 'active')       as active,
  count(*) filter (where e.status = 'completed')    as completed,
  count(*) filter (where e.status = 'replied')      as replied,
  count(*) filter (where e.status = 'unsubscribed') as unsubscribed,
  count(*) filter (where e.status = 'bounced')      as bounced,
  count(*)                                          as total,
  seq.campaign                                      as campaign  -- appended last
from enrollments e
join sequences seq on seq.id = e.sequence_id
group by seq.name, seq.campaign;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table senders     enable row level security;
alter table contacts    enable row level security;
alter table enrollments enable row level security;
alter table send_log    enable row level security;
alter table templates   enable row level security;
alter table sequences   enable row level security;

-- Service role bypasses RLS entirely (your webhook uses the service role
-- key). These permissive policies exist so the anon/authenticated roles
-- behave predictably if you ever query with them; tighten as needed.
-- `drop ... if exists` first so this block is safe to re-run.
drop policy if exists "service_role_all" on senders;
drop policy if exists "service_role_all" on contacts;
drop policy if exists "service_role_all" on enrollments;
drop policy if exists "service_role_all" on send_log;
drop policy if exists "service_role_all" on templates;
drop policy if exists "service_role_all" on sequences;

create policy "service_role_all" on senders     for all using (true);
create policy "service_role_all" on contacts    for all using (true);
create policy "service_role_all" on enrollments for all using (true);
create policy "service_role_all" on send_log    for all using (true);
create policy "service_role_all" on templates   for all using (true);
create policy "service_role_all" on sequences   for all using (true);
