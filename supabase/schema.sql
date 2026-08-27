-- ============================================================
-- Automate305 SEP · Supabase Schema
-- Run this in your Supabase SQL Editor (supabase.com/dashboard)
-- ============================================================

-- ── SENDERS ──────────────────────────────────────────────────
-- All 12 sending identities from aestheticdevicepro.com
create table if not exists senders (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  host        text not null default 'smtp.hostinger.com',
  port        int  not null default 465,
  campaign    text,           -- 'dp4' | 'clearview' | 'mixed'
  daily_limit int  not null default 5,   -- starts low, increase as warmed
  sends_today int  not null default 0,
  warmed      boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

-- Seed your 12 senders
insert into senders (email, name, campaign, daily_limit) values
  ('matt@aestheticdevicepro.com',    'Matt',     'mixed', 5),
  ('don@aestheticdevicepro.com',     'Don',      'mixed', 0),   -- alias, starts inactive
  ('ed@aestheticdevicepro.com',      'Ed',       'mixed', 0),
  ('eddie@aestheticdevicepro.com',   'Eddie',    'mixed', 0),
  ('matthew@aestheticdevicepro.com', 'Matthew',  'mixed', 0),
  ('rob@aestheticdevicepro.com',     'Rob',      'mixed', 0),
  ('tamiko@aestheticdevicepro.com',  'Tamiko',   'mixed', 5),
  ('jen@aestheticdevicepro.com',     'Jen',      'mixed', 0),
  ('jenny@aestheticdevicepro.com',   'Jenny',    'mixed', 0),
  ('jess@aestheticdevicepro.com',    'Jess',     'mixed', 0),
  ('jessica@aestheticdevicepro.com', 'Jessica',  'mixed', 0),
  ('tami@aestheticdevicepro.com',    'Tami',     'mixed', 0)
on conflict (email) do nothing;

-- ── SEQUENCES ────────────────────────────────────────────────
create table if not exists sequences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,   -- 'dp4' | 'clearview'
  description text,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

insert into sequences (name, description) values
  ('dp4',       'DP4 Microneedling device outreach · 3-step · aesthetics practices'),
  ('clearview', 'ClearVIEW device outreach · 3-step · aesthetics practices')
on conflict (name) do nothing;

-- ── TEMPLATES ────────────────────────────────────────────────
-- One row per step per sequence. Claude drafts go here.
create table if not exists templates (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid references sequences(id) on delete cascade,
  step         int  not null,        -- 1, 2, or 3
  subject      text not null,
  body_text    text not null,        -- plain text (primary)
  body_html    text,                 -- optional HTML version
  delay_days   int  not null default 0,  -- days after previous step
  created_at   timestamptz default now(),
  unique (sequence_id, step)
);

-- DP4 templates (Claude-drafted — edit these to match your actual copy)
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

-- ClearVIEW templates
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

-- ── CONTACTS ─────────────────────────────────────────────────
create table if not exists contacts (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  first_name     text,
  last_name      text,
  practice_name  text,
  title          text,
  phone          text,
  city           text,
  state          text default 'FL',
  source         text,           -- 'getleads' | 'apollo' | 'manual'
  unsubscribed   boolean not null default false,
  bounced        boolean not null default false,
  created_at     timestamptz default now()
);

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
-- Every email sent, every outcome.
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

-- What needs to go out today
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
  t.delay_days
from enrollments e
join contacts    c   on c.id  = e.contact_id
join sequences   seq on seq.id = e.sequence_id
join templates   t   on t.sequence_id = e.sequence_id and t.step = e.current_step
where e.status         = 'active'
  and e.next_send_date <= current_date
  and c.unsubscribed   = false
  and c.bounced        = false
order by e.next_send_date asc;

-- Sender availability today
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
  count(*)                                          as total
from enrollments e
join sequences seq on seq.id = e.sequence_id
group by seq.name;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table senders     enable row level security;
alter table contacts    enable row level security;
alter table enrollments enable row level security;
alter table send_log    enable row level security;
alter table templates   enable row level security;
alter table sequences   enable row level security;

-- Service role has full access (your webhook uses service role key)
create policy "service_role_all" on senders     for all using (true);
create policy "service_role_all" on contacts    for all using (true);
create policy "service_role_all" on enrollments for all using (true);
create policy "service_role_all" on send_log    for all using (true);
create policy "service_role_all" on templates   for all using (true);
create policy "service_role_all" on sequences   for all using (true);
