-- Per-user Ask NAC conversation anchors.
-- Stores branch, period, and the last question. It does not store figures as evidence.
-- Not applied to production by this change. Apply only after review.

create table if not exists public.ask_nac_conversation_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  branch_key text not null default '',
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint ask_nac_conversation_memory_context_size check (octet_length(context::text) <= 6000),
  constraint ask_nac_conversation_memory_user_branch unique (user_id, branch_key)
);

alter table public.ask_nac_conversation_memory enable row level security;

drop policy if exists ask_nac_conversation_memory_select on public.ask_nac_conversation_memory;
create policy ask_nac_conversation_memory_select
  on public.ask_nac_conversation_memory
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists ask_nac_conversation_memory_insert on public.ask_nac_conversation_memory;
create policy ask_nac_conversation_memory_insert
  on public.ask_nac_conversation_memory
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists ask_nac_conversation_memory_update on public.ask_nac_conversation_memory;
create policy ask_nac_conversation_memory_update
  on public.ask_nac_conversation_memory
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ask_nac_conversation_memory_delete on public.ask_nac_conversation_memory;
create policy ask_nac_conversation_memory_delete
  on public.ask_nac_conversation_memory
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.ask_nac_conversation_memory to authenticated;
revoke all on public.ask_nac_conversation_memory from anon;
