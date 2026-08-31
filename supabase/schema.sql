-- ============================================================
-- Automate305 SEP · Supabase Schema  (multi-brand rewrite)
--
-- One engine, two sending brands:
--   automate305         → HVAC / home services
--   aestheticdevicepro  → Tamiko campaigns (DP4, ClearView)
--
-- Brand isolation is structural: foreign keys + CHECK constraints
-- make cross-brand sends impossible at the database level.
--
-- Idempotent: safe to re-run on an existing project.
-- ============================================================

-- ── BRANDS ──────────────────────────────────────────────────
create table if not exists brands (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text not null,
  domain       text not null unique,
  provider     text not null default 'hostinger',
  status       text not null default 'active',
  created_at   timestamptz default now()
);

insert into brands (slug, display_name, domain, provider) values
  ('automate305',        'Automate305',        'automate305.com',        'hostinger'),
  ('aestheticdevicepro', 'Aesthetic Device Pro','aestheticdevicepro.com', 'hostinger')
on conflict (slug) do update set
  display_name = excluded.display_name,
  domain       = excluded.domain,
  provider     = excluded.provider;

-- ── MAILBOXES ───────────────────────────────────────────────
create table if not exists mailboxes (
  id               uuid primary key default gen_random_uuid(),
  address          text not null unique,
  brand_id         uuid not null references brands(id),
  display_name     text not null,
  provider         text not null default 'hostinger',
  status           text not null default 'WARMING',
  warmup_started_at timestamptz default now(),
  daily_cap        int  not null default 5,
  sends_today      int  not null default 0,
  health_score     int,
  last_scored_at   timestamptz,
  send_mode        text not null default 'SEED_ONLY',
  signature        text,
  reply_to         text,
  active           boolean not null default true,
  created_at       timestamptz default now(),

  constraint mailbox_status_check   check (status in ('WARMING','WARM','BLOCKED','SUSPENDED')),
  constraint mailbox_send_mode_check check (send_mode in ('OFF','SEED_ONLY','LIVE'))
);

-- Reject mailbox whose domain doesn't match its brand's domain
create or replace function check_mailbox_domain()
returns trigger language plpgsql as $$
declare
  brand_domain text;
begin
  select domain into brand_domain from brands where id = NEW.brand_id;
  if split_part(NEW.address, '@', 2) != brand_domain then
    insert into audit_log (event_type, details)
      values ('MAILBOX_DOMAIN_MISMATCH', jsonb_build_object(
        'address', NEW.address,
        'brand_id', NEW.brand_id,
        'expected_domain', brand_domain
      ));
    raise exception 'Mailbox domain "%" does not match brand domain "%"',
      split_part(NEW.address, '@', 2), brand_domain;
  end if;
  return NEW;
end;
$$;

-- Audit log (created before trigger references it)
create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,
  details    jsonb,
  created_at timestamptz default now()
);

drop trigger if exists trg_check_mailbox_domain on mailboxes;
create trigger trg_check_mailbox_domain
  before insert or update of address, brand_id on mailboxes
  for each row execute function check_mailbox_domain();

-- Seed mailboxes
-- aestheticdevicepro
insert into mailboxes (address, brand_id, display_name, status, send_mode, daily_cap, signature, reply_to)
select
  v.address,
  b.id,
  v.display_name,
  v.status,
  v.send_mode,
  v.daily_cap,
  v.signature,
  v.reply_to
from brands b,
(values
  ('matt@aestheticdevicepro.com',   'Matt',    'WARMING', 'SEED_ONLY', 5,  'Matt',    'matt@aestheticdevicepro.com'),
  ('tamiko@aestheticdevicepro.com', 'Tamiko',  'WARMING', 'SEED_ONLY', 5,  'Tamiko',  'tamiko@aestheticdevicepro.com')
) as v(address, display_name, status, send_mode, daily_cap, signature, reply_to)
where b.slug = 'aestheticdevicepro'
on conflict (address) do nothing;

-- automate305
insert into mailboxes (address, brand_id, display_name, status, send_mode, daily_cap, signature, reply_to)
select
  v.address,
  b.id,
  v.display_name,
  v.status,
  v.send_mode,
  v.daily_cap,
  v.signature,
  v.reply_to
from brands b,
(values
  ('cam@automate305.com', 'Camilo', 'WARM', 'LIVE', 5, 'Camilo | Automate305', 'cam@automate305.com')
) as v(address, display_name, status, send_mode, daily_cap, signature, reply_to)
where b.slug = 'automate305'
on conflict (address) do nothing;

-- ── CONTACTS ────────────────────────────────────────────────
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
  state                  text default 'FL',
  linkedin_url           text,
  source                 text,
  personalized_line      text,
  personalized_paragraph text,
  pain_point             text,
  area                   text,
  website_observation    text,
  tags                   jsonb default '[]'::jsonb,
  created_at             timestamptz default now()
);

-- ── CAMPAIGNS ───────────────────────────────────────────────
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id),
  slug        text not null unique,
  name        text not null,
  description text,
  status      text not null default 'active',
  created_at  timestamptz default now()
);

insert into campaigns (brand_id, slug, name, description)
select b.id, v.slug, v.name, v.description
from brands b,
(values
  ('aestheticdevicepro', 'dp4',       'DP4 Microneedling',  'DP4 device outreach into aesthetics practices'),
  ('aestheticdevicepro', 'clearview', 'ClearView Imaging',  'ClearView device outreach into aesthetics practices'),
  ('automate305',        'hvac_a',    'HVAC Sequence A',    'Offer-led (free website carrot) for weak/no website'),
  ('automate305',        'hvac_b',    'HVAC Sequence B',    'ROI/operator angle for established presence')
) as v(brand_slug, slug, name, description)
where b.slug = v.brand_slug
on conflict (slug) do nothing;

-- ── SEQUENCES ───────────────────────────────────────────────
create table if not exists sequences (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id),
  campaign_id uuid not null references campaigns(id),
  name        text not null,
  version     int  not null default 1,
  status      text not null default 'DRAFT',
  description text,
  created_at  timestamptz default now(),

  unique (name, version),
  constraint sequence_status_check check (status in ('DRAFT','APPROVED','ACTIVE','ARCHIVED'))
);

-- ── SEQUENCE STEPS (templates) ──────────────────────────────
create table if not exists sequence_steps (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references sequences(id) on delete cascade,
  step_number     int  not null,
  delay_days      int  not null default 0,
  channel         text not null default 'email',
  subject_template text not null,
  body_template   text not null,
  created_at      timestamptz default now(),

  unique (sequence_id, step_number)
);

-- Seed sequences and steps
-- DP4
do $$
declare
  _brand_id uuid;
  _campaign_id uuid;
  _seq_id uuid;
begin
  select id into _brand_id from brands where slug = 'aestheticdevicepro';
  select id into _campaign_id from campaigns where slug = 'dp4';

  insert into sequences (brand_id, campaign_id, name, version, status, description)
    values (_brand_id, _campaign_id, 'dp4_v1', 1, 'ACTIVE', 'DP4 3-step outreach')
    on conflict (name, version) do nothing
    returning id into _seq_id;

  if _seq_id is not null then
    insert into sequence_steps (sequence_id, step_number, delay_days, subject_template, body_template) values
      (_seq_id, 1, 0,
        'Quick question about your device lineup, {{first_name}}',
        'Hi {{first_name}},

I came across {{practice_name}} and wanted to reach out about a device that''s been getting strong adoption in practices like yours — the DP4 Microneedling system.

Practices are seeing measurable retention improvements (clients coming back specifically for it) and it adds a high-margin service without a long learning curve.

Worth a 10-minute call this week to see if it''s a fit?

Best,
{{sender_name}}'),
      (_seq_id, 2, 4,
        'Re: DP4 — one thing I forgot to mention',
        'Hi {{first_name}},

Following up from my note earlier this week.

One thing I didn''t mention — there''s a trade-in program running right now and a 14-day trial period. So there''s no risk to seeing it in your space before committing.

Still worth 10 minutes?

{{sender_name}}'),
      (_seq_id, 3, 8,
        'Closing the loop, {{first_name}}',
        'Hi {{first_name}},

Last note from me — I don''t want to keep reaching out if the timing isn''t right.

If you''d like to revisit the DP4 down the road, just reply and I''ll pick it back up. Happy to send a one-pager in the meantime if useful.

Either way, best of luck with {{practice_name}}.

{{sender_name}}');
  end if;
end$$;

-- ClearView
do $$
declare
  _brand_id uuid;
  _campaign_id uuid;
  _seq_id uuid;
begin
  select id into _brand_id from brands where slug = 'aestheticdevicepro';
  select id into _campaign_id from campaigns where slug = 'clearview';

  insert into sequences (brand_id, campaign_id, name, version, status, description)
    values (_brand_id, _campaign_id, 'clearview_v1', 1, 'ACTIVE', 'ClearView 3-step outreach')
    on conflict (name, version) do nothing
    returning id into _seq_id;

  if _seq_id is not null then
    insert into sequence_steps (sequence_id, step_number, delay_days, subject_template, body_template) values
      (_seq_id, 1, 0,
        '94% retention — the number that caught my eye, {{first_name}}',
        'Hi {{first_name}},

I''ll keep this short — I work with a device called ClearVIEW that''s showing a 94% patient retention rate across practices using it.

Dr. Croley (who you may know in the space) has been one of the vocal advocates. The results have been consistent enough that I wanted to bring it to {{practice_name}}''s attention.

Open to a quick call?

{{sender_name}}'),
      (_seq_id, 2, 4,
        'Re: ClearVIEW — following up',
        'Hi {{first_name}},

Just circling back on my last note about ClearVIEW.

The 94% retention stat tends to get attention because most practices struggle with exactly that — getting clients to come back consistently. This device makes the next appointment a natural conversation.

Worth 15 minutes to walk through the numbers?

{{sender_name}}'),
      (_seq_id, 3, 8,
        'Last note — ClearVIEW',
        'Hi {{first_name}},

Not going to keep following up after this — just wanted to leave the door open.

If ClearVIEW becomes relevant for {{practice_name}} later, reply anytime and I''ll get you current info.

Take care,
{{sender_name}}');
  end if;
end$$;

-- HVAC A
do $$
declare
  _brand_id uuid;
  _campaign_id uuid;
  _seq_id uuid;
begin
  select id into _brand_id from brands where slug = 'automate305';
  select id into _campaign_id from campaigns where slug = 'hvac_a';

  insert into sequences (brand_id, campaign_id, name, version, status, description)
    values (_brand_id, _campaign_id, 'hvac_a_v1', 1, 'ACTIVE', 'HVAC offer-led 4-step')
    on conflict (name, version) do nothing
    returning id into _seq_id;

  if _seq_id is not null then
    insert into sequence_steps (sequence_id, step_number, delay_days, subject_template, body_template) values
      (_seq_id, 1, 0,
        '{{company}} - quick question',
        'Hey {{first_name}},

{{personalized_line}}

I work with HVAC companies in the Miami area to automate the back-office stuff that eats up your day. Scheduling, dispatch, follow-ups, invoicing. So you can focus on jobs, not paperwork.

Would a 15-minute call this week make sense to see if there''s a fit?

{{signature}}'),
      (_seq_id, 2, 3,
        'Re: {{company}} - quick question',
        '{{first_name}},

Most HVAC companies I talk to are losing 20-30% of inbound leads because they can''t respond fast enough. Calls go to voicemail, web forms sit for hours.

One shop I worked with went from missing half their calls to booking 90% within 2 minutes, just by automating the intake.

Worth a quick conversation?

{{signature}}'),
      (_seq_id, 3, 4,
        'free website for {{company}}',
        '{{first_name}},

I took a look at {{company}}''s online presence. {{website_observation}}

I''m offering a handful of HVAC companies in the area a completely free website rebuild. No strings, no catch. I use it as a portfolio piece, you get a site that actually converts visitors into booked jobs.

If that sounds interesting, happy to show you what it''d look like.

{{signature}}'),
      (_seq_id, 4, 7,
        'closing the loop',
        '{{first_name}},

I''ve reached out a few times and haven''t heard back. Totally get it, you''re busy running jobs.

I''ll leave the door open: if you ever want to explore automating your scheduling, dispatch, or customer follow-ups, I''m a message away. The free website offer stands too.

Either way, hope {{company}} has a strong season.

{{signature}}');
  end if;
end$$;

-- HVAC B
do $$
declare
  _brand_id uuid;
  _campaign_id uuid;
  _seq_id uuid;
begin
  select id into _brand_id from brands where slug = 'automate305';
  select id into _campaign_id from campaigns where slug = 'hvac_b';

  insert into sequences (brand_id, campaign_id, name, version, status, description)
    values (_brand_id, _campaign_id, 'hvac_b_v1', 1, 'ACTIVE', 'HVAC ROI 4-step')
    on conflict (name, version) do nothing
    returning id into _seq_id;

  if _seq_id is not null then
    insert into sequence_steps (sequence_id, step_number, delay_days, subject_template, body_template) values
      (_seq_id, 1, 0,
        '{{first_name}}, quick question about {{company}}',
        'Hey {{first_name}},

{{personalized_paragraph}}

I''m curious, how are you handling {{pain_point}} right now? Most HVAC owners I talk to in the {{area}} area are still doing it manually, and it''s costing them 10-15 hours a week.

Happy to share what''s working for other shops if you''re open to a quick call.

{{signature}}'),
      (_seq_id, 2, 3,
        'Re: {{first_name}}, quick question about {{company}}',
        '{{first_name}},

Ran some rough numbers on what manual ops typically cost an HVAC shop your size:

- Missed calls to 3-5 lost jobs/week at $300-500 avg ticket = $4,500-10,000/month left on the table
- Slow follow-up to 40% of leads go cold after 5 minutes without a response
- Manual scheduling to 2-3 hours/day of admin instead of revenue-generating work

Not saying that''s you, but if any of those hit close, it''s worth a 15-minute conversation.

{{signature}}'),
      (_seq_id, 3, 4,
        'what other {{area}} HVAC shops are doing',
        '{{first_name}},

Without naming names, a few HVAC companies in {{area}} have started automating their intake, dispatch, and follow-ups. The ones that moved first are pulling ahead because:

- Leads get a text back in under 60 seconds (before the homeowner calls the next company on Google)
- Techs get dispatch updates on their phone instead of calling the office
- Invoices go out same-day, every time

I help shops set this up. No long contracts, no bloated software. Just the pieces that actually move the needle.

Worth a conversation?

{{signature}}'),
      (_seq_id, 4, 7,
        '15 min, {{first_name}}?',
        '{{first_name}},

I''ll keep this one short. I''ve got a few openings this week for a quick audit call.

I''ll look at your current setup (scheduling, lead response, follow-ups) and tell you exactly where you''re leaving money on the table. No cost, no pitch. Just a diagnostic.

If it''s not useful, you''ll know in the first 5 minutes and we''ll part ways.

{{first_name}}, just reply with a time that works and I''ll send an invite.

{{signature}}');
  end if;
end$$;

-- ── ENROLLMENTS ─────────────────────────────────────────────
create table if not exists enrollments (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  sequence_id     uuid not null references sequences(id) on delete cascade,
  brand_id        uuid not null references brands(id),
  campaign_id     uuid not null references campaigns(id),
  current_step    int  not null default 1,
  next_send_date  date not null default current_date,
  status          text not null default 'active',
  enrolled_at     timestamptz default now(),
  completed_at    timestamptz,

  unique (contact_id, sequence_id)
);

-- ── SEND LOG ────────────────────────────────────────────────
create table if not exists send_log (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid references enrollments(id) on delete cascade,
  contact_id    uuid references contacts(id) on delete cascade,
  mailbox_id    uuid references mailboxes(id),
  brand_id      uuid references brands(id),
  sequence_id   uuid references sequences(id),
  step          int  not null,
  subject       text,
  message_id    text,
  status        text not null default 'sent',
  sent_at       timestamptz default now(),
  error_message text
);

-- ── SEND QUEUE ──────────────────────────────────────────────
create table if not exists send_queue (
  id              uuid primary key default gen_random_uuid(),
  enrollment_id   uuid not null references enrollments(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  mailbox_id      uuid references mailboxes(id),
  brand_id        uuid not null references brands(id),
  campaign_id     uuid not null references campaigns(id),
  sequence_id     uuid not null references sequences(id),
  step_number     int  not null,
  subject         text not null,
  body            text not null,
  scheduled_at    timestamptz not null,
  status          text not null default 'PENDING',
  hold_reason     text,
  hold_expires_at timestamptz,
  slot_values     jsonb,
  created_at      timestamptz default now(),
  sent_at         timestamptz,
  error_message   text,

  constraint queue_status_check check (status in ('PENDING','HELD','SENDING','SENT','FAILED','SKIPPED','EXPIRED'))
);

-- ── CAMPAIGN → MAILBOX CONSTRAINT ───────────────────────────
-- A campaign can only send from a mailbox belonging to its own brand.
-- Enforced on send_queue: the brand_id of the campaign must match mailbox brand_id.
create or replace function check_queue_brand_match()
returns trigger language plpgsql as $$
declare
  mailbox_brand uuid;
begin
  if NEW.mailbox_id is null then return NEW; end if;
  select brand_id into mailbox_brand from mailboxes where id = NEW.mailbox_id;
  if mailbox_brand != NEW.brand_id then
    raise exception 'Mailbox brand (%) does not match campaign brand (%)',
      mailbox_brand, NEW.brand_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_check_queue_brand on send_queue;
create trigger trg_check_queue_brand
  before insert or update of mailbox_id on send_queue
  for each row execute function check_queue_brand_match();

-- Same constraint on send_log
create or replace function check_send_log_brand_match()
returns trigger language plpgsql as $$
declare
  mailbox_brand uuid;
begin
  if NEW.mailbox_id is null then return NEW; end if;
  select brand_id into mailbox_brand from mailboxes where id = NEW.mailbox_id;
  if mailbox_brand != NEW.brand_id then
    raise exception 'Send log: mailbox brand (%) does not match send brand (%)',
      mailbox_brand, NEW.brand_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_check_send_log_brand on send_log;
create trigger trg_check_send_log_brand
  before insert or update of mailbox_id on send_log
  for each row execute function check_send_log_brand_match();

-- ── SUPPRESSION ─────────────────────────────────────────────

-- Tier 1: GLOBAL blocklist (applies to ALL brands)
create table if not exists global_blocklist (
  id         uuid primary key default gen_random_uuid(),
  entry      text not null unique,
  entry_type text not null default 'email',
  reason     text,
  created_at timestamptz default now(),

  constraint blocklist_type_check check (entry_type in ('email','domain','pattern'))
);

-- Tier 2: BRAND suppression (unsubscribes, hard bounces)
create table if not exists brand_suppressions (
  id         uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references brands(id),
  email      text not null,
  reason     text not null,
  source     text,
  created_at timestamptz default now(),

  unique (brand_id, email)
);

-- ── REPLY INGESTION ─────────────────────────────────────────
create table if not exists inbound_messages (
  id             uuid primary key default gen_random_uuid(),
  mailbox_id     uuid references mailboxes(id),
  brand_id       uuid references brands(id),
  from_address   text not null,
  to_address     text not null,
  subject        text,
  body_text      text,
  message_id     text,
  in_reply_to    text,
  references_hdr text,
  classification text not null default 'UNKNOWN',
  matched_send_log_id uuid references send_log(id),
  processed      boolean not null default false,
  received_at    timestamptz default now(),

  constraint classification_check check (classification in (
    'REPLY','AUTO_REPLY','OOO','BOUNCE_HARD','BOUNCE_SOFT','UNSUBSCRIBE','UNKNOWN'
  ))
);

-- ── VOICE PROFILES ──────────────────────────────────────────
create table if not exists voice_profiles (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id) unique,
  sender_persona    text not null,
  tone_rules        text,
  banned_phrases    jsonb default '[]'::jsonb,
  banned_claims     jsonb default '[]'::jsonb,
  reference_examples jsonb default '[]'::jsonb,
  updated_at        timestamptz default now()
);

insert into voice_profiles (brand_id, sender_persona, tone_rules, banned_phrases, banned_claims)
select b.id, v.persona, v.tone, v.phrases::jsonb, v.claims::jsonb
from brands b,
(values
  ('automate305',
   'Camilo — owner/operator, sends as himself',
   'Plain, short sentences. No em dashes. Roughly 6th grade reading level. No corporate filler.',
   '["leveraging","synergy","cutting-edge","best-in-class","world-class","turnkey","paradigm"]',
   '[]'),
  ('aestheticdevicepro',
   'Matt or Tamiko — peer-to-peer into clinical audience (med spa owners, dermatologists, plastic surgeons)',
   'Specific and clinical-peer. Not salesy. Different register from HVAC voice.',
   '["leveraging","synergy","revolutionary","game-changer"]',
   '["clinically proven","FDA cleared for","proven to reduce","reduces wrinkles","eliminates acne","treats skin conditions","patient outcomes show","clinical results demonstrate","superior to","more effective than","safer than","best treatment for","cures","heals","repairs skin","reverses aging","anti-aging treatment","skin rejuvenation results","proven efficacy","guaranteed results"]')
) as v(brand_slug, persona, tone, phrases, claims)
where b.slug = v.brand_slug
on conflict (brand_id) do nothing;

-- ── CONTENT SOURCES ─────────────────────────────────────────
create table if not exists content_sources (
  id       uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id),
  title    text not null,
  type     text not null,
  body     text not null,
  created_at timestamptz default now()
);

-- ── HEALTH SCORE HISTORY ────────────────────────────────────
create table if not exists health_score_history (
  id                  uuid primary key default gen_random_uuid(),
  mailbox_id          uuid not null references mailboxes(id),
  total_score         int not null,
  inbox_placement_pct numeric,
  inbox_placement_pts numeric,
  bounce_rate_pct     numeric,
  bounce_rate_pts     int,
  complaint_rate_pct  numeric,
  complaint_rate_pts  int,
  postmaster_rep      text,
  postmaster_pts      int,
  reply_rate_pct      numeric,
  reply_rate_pts      int,
  hard_gate_failed    boolean not null default false,
  hard_gate_reason    text,
  seed_test_missing   boolean not null default false,
  computed_at         timestamptz default now()
);

-- ── DNS CHECK RESULTS ───────────────────────────────────────
create table if not exists dns_check_results (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id),
  mx_pass     boolean,
  spf_pass    boolean,
  dkim_pass   boolean,
  dmarc_pass  boolean,
  blacklist_clean boolean,
  postmaster_verified boolean,
  details     jsonb,
  checked_at  timestamptz default now()
);

-- ── AI COST LOG ─────────────────────────────────────────────
create table if not exists ai_cost_log (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references brands(id),
  model        text not null,
  task_type    text not null,
  input_tokens int  not null default 0,
  output_tokens int not null default 0,
  cached_tokens int not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  metadata     jsonb,
  created_at   timestamptz default now()
);

-- ── GLOBAL SETTINGS ─────────────────────────────────────────
create table if not exists global_settings (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

insert into global_settings (key, value) values
  ('kill_switch', 'false'::jsonb),
  ('monthly_ai_budget_usd', '50'::jsonb),
  ('send_window_start_hour', '9'::jsonb),
  ('send_window_end_hour', '17'::jsonb),
  ('send_window_timezone', '"America/New_York"'::jsonb)
on conflict (key) do nothing;

-- ── DAILY RESET FUNCTION ────────────────────────────────────
create or replace function reset_daily_sends()
returns void language sql as $$
  update mailboxes set sends_today = 0;
$$;

-- ── VIEWS ───────────────────────────────────────────────────

create or replace view available_mailboxes as
select m.*, b.slug as brand_slug, b.domain as brand_domain
from mailboxes m
join brands b on b.id = m.brand_id
where m.active = true
  and m.send_mode != 'OFF'
  and m.sends_today < m.daily_cap
order by m.sends_today asc;

create or replace view pipeline_summary as
select
  seq.name                                          as sequence,
  c.slug                                            as campaign,
  b.slug                                            as brand,
  count(*) filter (where e.status = 'active')       as active,
  count(*) filter (where e.status = 'completed')    as completed,
  count(*) filter (where e.status = 'replied')      as replied,
  count(*) filter (where e.status = 'unsubscribed') as unsubscribed,
  count(*) filter (where e.status = 'bounced')      as bounced,
  count(*)                                          as total
from enrollments e
join sequences seq on seq.id = e.sequence_id
join campaigns c   on c.id   = e.campaign_id
join brands    b   on b.id   = e.brand_id
group by seq.name, c.slug, b.slug;

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array[
    'brands','mailboxes','contacts','campaigns','sequences','sequence_steps',
    'enrollments','send_log','send_queue','global_blocklist','brand_suppressions',
    'inbound_messages','voice_profiles','content_sources','health_score_history',
    'dns_check_results','ai_cost_log','global_settings','audit_log'
  ]) loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "service_role_all" on %I', tbl);
    execute format('create policy "service_role_all" on %I for all using (true)', tbl);
  end loop;
end$$;
