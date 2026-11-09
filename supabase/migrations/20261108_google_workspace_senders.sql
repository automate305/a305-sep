-- ============================================================================
-- Add hello@ and info@ as warmable Google Workspace senders
--
-- hello@ already exists with the wrong SMTP host (Hostinger instead of
-- Gmail). Fix it and create info@. Both are aliases of cam@automate305.com
-- sharing the same Google Workspace account, app password and reputation.
--
-- Neither is activated here — the operator starts their warmup from the
-- dashboard or a follow-up migration once SMTP_PASS_CAM is confirmed.
-- ============================================================================

-- Fix hello@: correct the SMTP host from Hostinger to Gmail
update senders
set host = 'smtp.gmail.com',
    port = 465
where email = 'hello@automate305.com'
  and host = 'smtp.hostinger.com';

-- Create info@ if it does not already exist
insert into senders (email, name, host, port, daily_limit, warmed, active, campaign)
values ('info@automate305.com', 'Camilo', 'smtp.gmail.com', 465, 0, false, false, 'hvac')
on conflict (email) do nothing;
