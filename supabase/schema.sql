-- MintIQ memo archive. Run in the Supabase SQL editor (or `supabase db push`).
create table if not exists public.mintiq_memos (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  business_name text not null,
  source        text not null check (source in ('ui', 'webhook', 'sample')),
  intake        jsonb not null,
  memo          jsonb not null,
  stats         jsonb,
  delivered_to  text,
  created_at    timestamptz not null default now()
);
create index if not exists mintiq_memos_created_at_idx on public.mintiq_memos (created_at desc);
create index if not exists mintiq_memos_business_name_idx on public.mintiq_memos (lower(business_name));

-- The server uses the service-role key; keep the table closed to anon/authenticated clients.
alter table public.mintiq_memos enable row level security;
