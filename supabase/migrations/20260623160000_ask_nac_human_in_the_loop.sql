-- Human-in-the-loop executive intelligence: manual inputs, pending sessions, operator memory.

create table if not exists public.ask_nac_pending_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  session_type text not null default 'weekly_dashboard'
    check (session_type in ('weekly_dashboard', 'management_report')),
  status text not null default 'pending'
    check (status in ('pending', 'complete', 'cancelled')),
  missing_fields jsonb not null default '[]'::jsonb,
  provided_inputs jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_by text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_pending_sessions_user_branch
  on public.ask_nac_pending_sessions (created_by, branch_id, session_type, status);

comment on table public.ask_nac_pending_sessions is
  'Unfinished Ask NAC workflows (e.g. weekly dashboard) awaiting user-provided inputs.';

create table if not exists public.ask_nac_manual_inputs (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  report_type text not null default 'weekly_dashboard',
  metric_key text not null,
  metric_label text,
  metric_value numeric,
  metric_text text,
  period_start date not null,
  period_end date not null,
  period_label text,
  pending_session_id uuid references public.ask_nac_pending_sessions (id) on delete set null,
  provided_by text not null,
  created_at timestamptz not null default now(),
  unique (branch_id, report_type, metric_key, period_start, period_end)
);

create index if not exists idx_ask_nac_manual_inputs_period
  on public.ask_nac_manual_inputs (branch_id, report_type, period_start, period_end);

comment on table public.ask_nac_manual_inputs is
  'Period-specific operator-provided values (e.g. 7Rooms covers for one week). Not reused across periods.';

create table if not exists public.ask_nac_operator_memory (
  id uuid primary key default gen_random_uuid(),
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  category text not null default 'operational'
    check (category in ('policy', 'demand_driver', 'operational', 'weather', 'competitive', 'general')),
  fact text not null,
  taught_by text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_operator_memory_branch_active
  on public.ask_nac_operator_memory (branch_id, active, created_at desc);

comment on table public.ask_nac_operator_memory is
  'Permanent operator-taught knowledge via Teach NAC / Remember this commands.';

-- RLS
alter table public.ask_nac_pending_sessions enable row level security;
alter table public.ask_nac_manual_inputs enable row level security;
alter table public.ask_nac_operator_memory enable row level security;

drop policy if exists ask_nac_pending_sessions_select on public.ask_nac_pending_sessions;
create policy ask_nac_pending_sessions_select on public.ask_nac_pending_sessions
  for select to authenticated
  using (
    lower(created_by) = lower(public.ask_nac_vault_auth_email())
    and public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_pending_sessions_insert on public.ask_nac_pending_sessions;
create policy ask_nac_pending_sessions_insert on public.ask_nac_pending_sessions
  for insert to authenticated
  with check (
    lower(created_by) = lower(public.ask_nac_vault_auth_email())
    and public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_pending_sessions_update on public.ask_nac_pending_sessions;
create policy ask_nac_pending_sessions_update on public.ask_nac_pending_sessions
  for update to authenticated
  using (
    lower(created_by) = lower(public.ask_nac_vault_auth_email())
    and public.ask_nac_vault_branch_allowed(branch_id)
  )
  with check (
    lower(created_by) = lower(public.ask_nac_vault_auth_email())
    and public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_manual_inputs_select on public.ask_nac_manual_inputs;
create policy ask_nac_manual_inputs_select on public.ask_nac_manual_inputs
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists ask_nac_manual_inputs_insert on public.ask_nac_manual_inputs;
create policy ask_nac_manual_inputs_insert on public.ask_nac_manual_inputs
  for insert to authenticated
  with check (
    lower(provided_by) = lower(public.ask_nac_vault_auth_email())
    and public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_manual_inputs_update on public.ask_nac_manual_inputs;
create policy ask_nac_manual_inputs_update on public.ask_nac_manual_inputs
  for update to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id))
  with check (
    lower(provided_by) = lower(public.ask_nac_vault_auth_email())
    and public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_operator_memory_select on public.ask_nac_operator_memory;
create policy ask_nac_operator_memory_select on public.ask_nac_operator_memory
  for select to authenticated
  using (
    branch_id is null
    or public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists ask_nac_operator_memory_insert on public.ask_nac_operator_memory;
create policy ask_nac_operator_memory_insert on public.ask_nac_operator_memory
  for insert to authenticated
  with check (
    lower(taught_by) = lower(public.ask_nac_vault_auth_email())
    and (branch_id is null or public.ask_nac_vault_branch_allowed(branch_id))
  );

grant select, insert, update on public.ask_nac_pending_sessions to authenticated;
grant select, insert, update on public.ask_nac_manual_inputs to authenticated;
grant select, insert on public.ask_nac_operator_memory to authenticated;
