-- Additive send-pipeline columns and the outbox run log.
-- Safe to run more than once. Does not drop or rewrite existing rows.
-- Apply this before the next weekday daily-send.

alter table public.senders add column if not exists warmed_at timestamptz;
alter table public.senders add column if not exists sends_today_on date;

alter table public.send_log add column if not exists message_id text;

create table if not exists public.outbox_run_log (
  id          uuid primary key default gen_random_uuid(),
  run_at      timestamptz not null default now(),
  job         text not null,
  campaign    text,
  status      text not null,
  stop_reason text,
  counts      jsonb not null default '{}'::jsonb,
  details     jsonb not null default '{}'::jsonb
);

create index if not exists outbox_run_log_run_at_idx
  on public.outbox_run_log (run_at desc);

alter table public.outbox_run_log enable row level security;

revoke all on table public.outbox_run_log from anon, authenticated;
grant select, insert, update, delete on table public.outbox_run_log to service_role;

-- Zero today's counter only when it still belongs to an earlier
-- America/New_York date. A second run on the same ET date is a no-op.
create or replace function public.reset_daily_sends()
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.senders
  set sends_today = 0,
      sends_today_on = (timezone('America/New_York', now()))::date
  where sends_today_on is distinct from (timezone('America/New_York', now()))::date;
end;
$$;

revoke execute on function public.reset_daily_sends() from public, anon, authenticated;
grant execute on function public.reset_daily_sends() to service_role;
