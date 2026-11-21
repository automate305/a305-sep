-- A reply or hard bounce has to stop every in-flight step, including one
-- still sitting in the approval queue. The previous function left held and
-- paused enrollments alone and labeled every stand-down as unsubscribed,
-- so a reply disappeared from the pipeline and could still be approved.
--
-- Same six arguments. CREATE OR REPLACE keeps the existing grants' target.
-- Running it twice replaces the same function.

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
  terminal_status   text := case suppression_source
    when 'reply' then 'replied'
    when 'bounce' then 'bounced'
    else 'unsubscribed'
  end;
begin
  if normalized_email is null or normalized_email = '' then
    raise exception 'contact_email is required';
  end if;

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
    if terminal_status = 'bounced' then
      update contacts set bounced = true where id = found_contact_id;
    end if;

    -- A reply is not an opt-out. The suppression row keeps them out of the
    -- queue, and the enrollment status stays 'replied' so the pipeline can
    -- count it. Bounce and unsubscribe still raise the older contact flag.
    if suppression_scope = 'global' and terminal_status <> 'replied' then
      update contacts set unsubscribed = true where id = found_contact_id;
    end if;

    with stood_down_enrollments as (
      update enrollments e
      set status = terminal_status,
          completed_at = now(),
          hold_reason = null,
          held_at = null
      from sequences seq
      where e.sequence_id = seq.id
        and e.contact_id = found_contact_id
        and e.status in ('active', 'held', 'paused')
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

revoke execute on function public.suppress_contact(text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.suppress_contact(text, text, text, text, text, text)
  to service_role;
