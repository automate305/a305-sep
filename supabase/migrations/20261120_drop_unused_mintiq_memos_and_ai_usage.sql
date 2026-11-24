-- Both tables belonged to features removed from OUTBOX (MintIQ and the AI spend
-- display). Both were empty when dropped; the guard refuses if that changes.
do $$
begin
  if (select count(*) from public.mintiq_memos) > 0 or (select count(*) from public.ai_usage) > 0 then
    raise exception 'refusing to drop: mintiq_memos or ai_usage has rows';
  end if;
end $$;

drop table if exists public.mintiq_memos;
drop table if exists public.ai_usage;
