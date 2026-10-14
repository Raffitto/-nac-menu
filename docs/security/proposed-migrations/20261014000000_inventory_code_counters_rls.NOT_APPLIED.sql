-- NOT APPLIED. Do not run against production until the owner approves it.
--
-- Live finding, 2026-10-14, project zeyhvjuraqnlbdycgrme:
-- Security Advisor error rls_disabled_in_public on public.inventory_code_counters.
-- RLS is off, there are no policies, and anon and authenticated have
-- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER.
-- The public Data API exposes this table. It holds seven rows:
-- the next human-code number for families F, B, C, CL, P, E, and M.
-- An anonymous client can read those numbers and rewrite them.
--
-- allocate_inventory_human_code(text) is security definer, owned by postgres.
-- Enabling RLS does not block that function, because the owner bypasses RLS.
-- Do not FORCE row level security. Authenticated staff keep EXECUTE.
-- Anon also has EXECUTE, which the creating migration did not grant.
-- Revoke that so an anonymous RPC cannot advance the counter.
--
-- No permissive policies. Direct table access by anon and authenticated stops.

begin;

alter table public.inventory_code_counters enable row level security;

revoke all on table public.inventory_code_counters from anon, authenticated;

revoke execute on function public.allocate_inventory_human_code(text) from anon;

commit;

-- Rollback
-- begin;
-- grant select, insert, update, delete, truncate, references, trigger
--   on table public.inventory_code_counters to anon, authenticated;
-- grant execute on function public.allocate_inventory_human_code(text) to anon;
-- alter table public.inventory_code_counters disable row level security;
-- commit;
