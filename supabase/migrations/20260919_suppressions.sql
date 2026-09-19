-- ============================================================================
-- Phase 2 · Real unsubscribe and suppression
--
-- Additive only. No existing column, constraint, view condition or row is
-- dropped or rewritten. Safe to run against the live database with its 337
-- enrollments in place; running it twice is a no-op.
--
-- What it adds:
--   1. suppressions          — the durable record of who must not be mailed
--   2. todays_queue          — EXTENDED with a suppression check, both
--                              original conditions kept exactly as they were
--   3. suppress_contact()    — one function = one transaction, so the
--                              suppression row, the contact flag and the
--                              enrollment stand-down either all land or none do
--   4. reinstate_contact()   — the reverse, for a mistaken suppression
--
-- The `campaign` key model is preserved. No brands or mailboxes table.
-- ============================================================================


-- ── SUPPRESSIONS ────────────────────────────────────────────────────────────
-- One row per suppressed address or domain.
--
--   scope 'global'   → never mail this address, under any brand
--   scope 'campaign' → never mail it for this campaign key ('hvac',
--                      'aesthetic'); the other brand is unaffected
--
-- An unsubscribe defaults to 'global': a person who opts out of one brand's
-- mail has not agreed to hear from the other.
create table if not exists suppressions (
  id           uuid primary key default gen_random_uuid(),
  -- The address or bare domain, always stored lowercase.
  value        text not null,
  match_type   text not null default 'email'
                 check (match_type in ('email', 'domain')),
  scope        text not null default 'global'
                 check (scope in ('global', 'campaign')),
  -- Null for global scope; the campaign key for campaign scope.
  campaign     text,
  reason       text not null,
  -- Where it came from: 'one-click', 'reply', 'manual', 'import', 'bounce'.
  source       text not null default 'manual',
  -- Phase 4 will make this a real operator identity. Until then it records
  -- whatever the caller supplies, and null means "not recorded".
  created_by   text,
  created_at   timestamptz not null default now(),

  constraint suppressions_campaign_matches_scope check (
    (scope = 'global'   and campaign is null) or
    (scope = 'campaign' and campaign is not null)
  )
);

-- One suppression per value per scope. Postgres treats NULLs as distinct in a
-- unique index, so global rows (campaign is null) need their own partial index
-- or a second global entry could be inserted for the same address.
create unique index if not exists suppressions_global_value_idx
  on suppressions (value, match_type)
  where scope = 'global';

create unique index if not exists suppressions_campaign_value_idx
  on suppressions (value, match_type, campaign)
  where scope = 'campaign';

-- Supports the todays_queue lookup below.
create index if not exists suppressions_value_idx on suppressions (value);

alter table suppressions enable row level security;
-- Deliberately zero policies, matching every other table here: anon and
-- authenticated are denied outright and service_role (which bypasses RLS) is
-- the only accessor. The public unsubscribe route reaches this table through
-- the server, never from the browser.


-- ── TODAYS_QUEUE · EXTENDED ─────────────────────────────────────────────────
-- The live send gate. Both original suppression conditions are kept verbatim
-- (c.unsubscribed = false, c.bounced = false) and the suppressions check is
-- added alongside them. Nothing is replaced.
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
  -- Added in Phase 2: an address or its domain on the suppression list never
  -- reaches the queue, whether the block is global or scoped to this campaign.
  and not exists (
    select 1
    from suppressions s
    where (s.scope = 'global' or (s.scope = 'campaign' and s.campaign = seq.campaign))
      and (
        (s.match_type = 'email'  and s.value = lower(c.email)) or
        (s.match_type = 'domain' and s.value = lower(split_part(c.email, '@', 2)))
      )
  )
order by e.next_send_date;


-- ── SUPPRESS_CONTACT ────────────────────────────────────────────────────────
-- Everything an unsubscribe must do, in one transaction. A plpgsql function
-- body is a single transaction, so either the suppression row, the contact
-- flag and the enrollment stand-down all commit, or none of them do. Doing
-- these as three separate client calls is what leaves a contact suppressed in
-- one place and mailable in another.
--
-- Deliberately NOT security definer: the caller is the server holding the
-- service role key. Nothing is granted to anon, so the browser cannot reach it.
--
-- Held enrollments are left strictly alone — only status = 'active' rows stand
-- down. The 337 held enrollments are not this function's business.
create or replace function suppress_contact(
  contact_email      text,
  suppression_reason text,
  suppression_source text default 'manual',
  suppression_scope  text default 'global',
  suppression_campaign text default null,
  actor              text default null
) returns jsonb
language plpgsql
as $$
declare
  normalized_email  text := lower(trim(contact_email));
  found_contact_id  uuid;
  stood_down        integer := 0;
  suppression_id    uuid;
begin
  if normalized_email is null or normalized_email = '' then
    raise exception 'contact_email is required';
  end if;

  -- Record the suppression first. This happens even when no contact row
  -- exists, so a later import of that address is blocked on arrival.
  insert into suppressions (value, match_type, scope, campaign, reason, source, created_by)
  values (
    normalized_email,
    'email',
    suppression_scope,
    case when suppression_scope = 'campaign' then suppression_campaign else null end,
    suppression_reason,
    suppression_source,
    actor
  )
  on conflict do nothing
  returning id into suppression_id;

  if suppression_id is null then
    select id into suppression_id
    from suppressions
    where value = normalized_email
      and match_type = 'email'
      and scope = suppression_scope
      and (campaign is not distinct from
           case when suppression_scope = 'campaign' then suppression_campaign else null end)
    limit 1;
  end if;

  select id into found_contact_id from contacts where lower(email) = normalized_email limit 1;

  if found_contact_id is not null then
    -- The contacts flag is the older gate and stays authoritative for a global
    -- opt-out. A campaign-scoped suppression must not set it, or opting out of
    -- one brand would silently opt the person out of the other.
    if suppression_scope = 'global' then
      update contacts set unsubscribed = true where id = found_contact_id;
    end if;

    with stood_down_enrollments as (
      update enrollments e
      set status = 'unsubscribed',
          completed_at = now()
      from sequences seq
      where e.sequence_id = seq.id
        and e.contact_id = found_contact_id
        and e.status = 'active'
        and (suppression_scope = 'global' or seq.campaign = suppression_campaign)
      returning e.id
    )
    select count(*) into stood_down from stood_down_enrollments;
  end if;

  return jsonb_build_object(
    'contact_found', found_contact_id is not null,
    'contact_id', found_contact_id,
    'email', normalized_email,
    'enrollments_stood_down', stood_down,
    'scope', suppression_scope,
    'suppression_id', suppression_id
  );
end;
$$;


-- ── REINSTATE_CONTACT ───────────────────────────────────────────────────────
-- Undoes a suppression applied in error. It clears the flag and the rows but
-- deliberately does NOT restart any enrollment: resuming a sequence is a
-- decision for an operator, not a side effect of fixing a mistake.
create or replace function reinstate_contact(
  contact_email text,
  reinstate_scope text default 'global',
  reinstate_campaign text default null
) returns jsonb
language plpgsql
as $$
declare
  normalized_email text := lower(trim(contact_email));
  removed integer := 0;
begin
  delete from suppressions
  where value = normalized_email
    and match_type = 'email'
    and scope = reinstate_scope
    and (campaign is not distinct from
         case when reinstate_scope = 'campaign' then reinstate_campaign else null end);
  get diagnostics removed = row_count;

  if reinstate_scope = 'global' then
    update contacts set unsubscribed = false where lower(email) = normalized_email;
  end if;

  return jsonb_build_object(
    'email', normalized_email,
    'suppressions_removed', removed
  );
end;
$$;
