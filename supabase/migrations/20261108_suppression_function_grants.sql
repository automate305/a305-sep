-- ============================================================================
-- Phase 2 follow-up · Lock the suppression functions to the server
--
-- Supabase grants EXECUTE on every new public function to PUBLIC, anon and
-- authenticated by default, so 20260919_suppressions.sql left
-- suppress_contact() and reinstate_contact() callable with the public API key.
-- Row level security (zero policies on suppressions, contacts and enrollments)
-- already made those calls change nothing, but that protection would vanish
-- the day anyone adds a policy. Revoke the grant so the functions are reachable
-- only by service_role, which the server holds and which keeps its own explicit
-- grant.
--
-- Idempotent: revoking a privilege that is not held is a no-op.
-- ============================================================================

revoke execute on function public.suppress_contact(text, text, text, text, text, text)
  from public, anon, authenticated;

revoke execute on function public.reinstate_contact(text, text, text)
  from public, anon, authenticated;
