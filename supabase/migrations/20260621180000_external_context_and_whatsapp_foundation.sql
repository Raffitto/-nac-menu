-- =============================================================================
-- External Context Intelligence + WhatsApp foundation (schema only)
-- Safe to re-run (idempotent). NOT applied to production automatically.
-- No live API collectors. No WhatsApp webhook in this migration.
--
-- WRITES: service-role / Edge only for now. authenticated has SELECT only.
-- Write RLS policies are defense-in-depth if INSERT/UPDATE grants are added later.
--
-- Apply order: staging first. Verify JWT role matrix before production.
-- =============================================================================

-- ── 1. Competitor registry ───────────────────────────────────────────────────

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  area_label text,
  category text not null default 'restaurant'
    check (category in ('restaurant', 'cafe', 'mall_concept', 'other')),
  google_place_id text,
  instagram_handle text,
  website_url text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Branch-scoped competitors: one normalized name per branch.
create unique index if not exists idx_competitors_normalized_branch_scoped
  on public.competitors (normalized_name, branch_id)
  where branch_id is not null;

-- Network-wide competitors (admin-only read): one normalized name globally.
create unique index if not exists idx_competitors_normalized_network
  on public.competitors (normalized_name)
  where branch_id is null;

drop index if exists idx_competitors_normalized_branch;

create index if not exists idx_competitors_branch_active
  on public.competitors (branch_id, is_active);

comment on table public.competitors is
  'Configurable competitor registry per branch/area. branch_id IS NULL rows are network registry (admin read only).';

comment on column public.competitors.branch_id is
  'NULL = network-wide registry row (not visible to branch-only users). Prefer branch_id for branch competitors.';

-- ── 2. External context signals ─────────────────────────────────────────────

create table if not exists public.external_context_signals (
  id uuid primary key default gen_random_uuid(),
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  applies_to_all_branches boolean not null default false,
  signal_type text not null check (signal_type in (
    'weather', 'competitor', 'mall_event', 'public_holiday', 'school_calendar',
    'local_event', 'traffic', 'road_closure', 'news', 'tourism', 'macro', 'manual_observation'
  )),
  signal_subtype text,
  title text not null,
  description text,
  signal_date date,
  start_at timestamptz,
  end_at timestamptz,
  location_label text,
  source_type text not null default 'manual'
    check (source_type in ('manual', 'api', 'import', 'staff_report')),
  source_name text,
  source_url text,
  source_reliability numeric(4, 3) check (source_reliability is null or (source_reliability >= 0 and source_reliability <= 1)),
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  relevance_score numeric(4, 3) check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 1)),
  impact_direction text check (impact_direction is null or impact_direction in ('up', 'down', 'neutral', 'mixed', 'unknown')),
  impacted_metrics text[] not null default '{}',
  related_competitor_id uuid references public.competitors (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Network signals (macro, public_holiday, etc.) MUST set applies_to_all_branches = true.
  -- Branch signals MUST set branch_id and applies_to_all_branches = false.
  constraint external_context_signals_scope check (
    (
      applies_to_all_branches = true
      and branch_id is null
    )
    or (
      applies_to_all_branches = false
      and branch_id is not null
    )
  )
);

create index if not exists idx_external_context_signals_branch_date
  on public.external_context_signals (branch_id, signal_date desc);

create index if not exists idx_external_context_signals_type_date
  on public.external_context_signals (signal_type, signal_date desc);

create index if not exists idx_external_context_signals_branch_window
  on public.external_context_signals (branch_id, start_at, end_at);

drop index if exists idx_external_context_signals_window;

comment on table public.external_context_signals is
  'External context for NIL. Network rows: applies_to_all_branches=true, branch_id null. Branch rows: branch_id set, applies_to_all_branches=false.';

comment on column public.external_context_signals.applies_to_all_branches is
  'When true (and branch_id null), readable by any authenticated user with branch access. Ingest macro/holiday signals with this flag.';

-- ── 3. Competitor observations ───────────────────────────────────────────────

create table if not exists public.competitor_observations (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  observation_date date not null default current_date,
  observed_traffic_level text check (observed_traffic_level is null or observed_traffic_level in ('low', 'normal', 'high', 'very_high')),
  promotion_detected boolean not null default false,
  event_detected boolean not null default false,
  football_screening boolean not null default false,
  influencer_activity boolean not null default false,
  price_offer text,
  menu_launch text,
  observation_text text not null,
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('public', 'internal', 'management', 'confidential')),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'manager_report', 'staff_report', 'import')),
  source_reliability numeric(4, 3) check (source_reliability is null or (source_reliability >= 0 and source_reliability <= 1)),
  confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low')),
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_competitor_observations_branch_date
  on public.competitor_observations (branch_id, observation_date desc);

create index if not exists idx_competitor_observations_competitor_date
  on public.competitor_observations (competitor_id, observation_date desc);

create index if not exists idx_competitor_observations_sensitivity
  on public.competitor_observations (branch_id, sensitivity_level);

comment on table public.competitor_observations is
  'Competitor activity notes. sensitivity_level gates read via ask_nac_vault_can_read_sensitivity (confidential → management).';

comment on column public.competitor_observations.sensitivity_level is
  'public|internal|management|confidential — confidential mapped to vault management ceiling for RLS.';

-- ── 4. WhatsApp allowlist (foundation — no webhook yet) ─────────────────────

create table if not exists public.whatsapp_users (
  id uuid primary key default gen_random_uuid(),
  phone_number_e164 text not null check (phone_number_e164 ~ '^\+[1-9]\d{1,14}$'),
  display_name text,
  -- Optional link to Supabase Auth user; webhook must still verify ask_nac_staff / branch access.
  linked_user_id uuid references auth.users (id) on delete set null,
  linked_email text check (linked_email is null or linked_email = lower(trim(linked_email))),
  vault_role text not null references public.ask_nac_roles (code),
  primary_branch_id text check (primary_branch_id is null or primary_branch_id in ('khobar', 'riyadh', 'jeddah')),
  allowed_branch_ids text[] not null default '{}',
  is_active boolean not null default true,
  is_admin boolean not null default false,
  can_request_exports boolean not null default false,
  can_receive_push_alerts boolean not null default false,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ar')),
  developer_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint whatsapp_users_phone_unique unique (phone_number_e164),
  constraint whatsapp_allowed_branches_valid check (
    allowed_branch_ids <@ array['khobar', 'riyadh', 'jeddah']::text[]
  )
);

create index if not exists idx_whatsapp_users_active on public.whatsapp_users (is_active);

create unique index if not exists idx_whatsapp_users_phone on public.whatsapp_users (phone_number_e164);

comment on table public.whatsapp_users is
  'WhatsApp allowlist. Authorization at webhook MUST re-check ask_nac_staff / ask_nac_vault_branch_allowed — do not trust vault_role or is_admin on this row alone.';

comment on column public.whatsapp_users.is_admin is
  'Legacy flag only; webhook authorization must use NAC OS vault RBAC helpers, not this column alone.';

comment on column public.whatsapp_users.linked_user_id is
  'Optional auth.users link. FK does not grant access; webhook resolves permissions from vault staff matrix.';

-- ── 5. WhatsApp message audit log ───────────────────────────────────────────

create table if not exists public.whatsapp_message_logs (
  id uuid primary key default gen_random_uuid(),
  whatsapp_user_id uuid references public.whatsapp_users (id) on delete set null,
  phone_number_e164 text not null,
  inbound_message text not null,
  normalized_question text,
  resolved_intent text,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  allowed boolean not null default false,
  denial_reason text,
  response_summary text,
  response_type text check (response_type is null or response_type in (
    'nil_why', 'cash_up', 'delivery_mix', 'compare', 'help', 'clarification', 'denied', 'error'
  )),
  latency_ms int check (latency_ms is null or latency_ms >= 0),
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_message_logs_phone_created
  on public.whatsapp_message_logs (phone_number_e164, created_at desc);

create index if not exists idx_whatsapp_message_logs_user_created
  on public.whatsapp_message_logs (whatsapp_user_id, created_at desc);

create index if not exists idx_whatsapp_message_logs_created_at
  on public.whatsapp_message_logs (created_at desc);

create unique index if not exists idx_whatsapp_message_logs_provider_message_id
  on public.whatsapp_message_logs (provider_message_id)
  where provider_message_id is not null;

comment on table public.whatsapp_message_logs is
  'WhatsApp audit trail (PII: phone + message text). Retention policy TBD — plan archival/purge before high volume. Inserts via service role only.';

-- ── 6. RLS helpers ───────────────────────────────────────────────────────────

-- Any authenticated vault user with at least one branch grant or primary branch.
create or replace function public.ask_nac_has_any_branch_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.ask_nac_vault_has_all_branches() then true
    when exists (
      select 1
      from public.ask_nac_user_branch_access ba
      where lower(ba.email) = public.ask_nac_vault_auth_email()
    ) then true
    when exists (
      select 1
      from public.ask_nac_staff s
      where lower(s.email) = public.ask_nac_vault_auth_email()
        and s.primary_branch_id is not null
    ) then true
    else false
  end;
$$;

comment on function public.ask_nac_has_any_branch_access() is
  'True when caller has cross-branch role or any explicit/primary branch assignment.';

-- Read external_context_signals / branch-scoped rows.
create or replace function public.ask_nac_external_context_branch_allowed(
  p_branch_id text,
  p_applies_to_all boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.ask_nac_vault_has_all_branches() then true
    when coalesce(p_applies_to_all, false) and public.ask_nac_has_any_branch_access() then true
    when p_branch_id is not null and public.ask_nac_vault_branch_allowed(p_branch_id) then true
    else false
  end;
$$;

comment on function public.ask_nac_external_context_branch_allowed(text, boolean) is
  'Read: all-branch rows visible to any branch user; branch rows need branch access; NULL branch without all-branch flag = deny.';

-- Write external_context_signals (defense-in-depth; no authenticated INSERT grant today).
create or replace function public.ask_nac_external_context_can_write(
  p_branch_id text,
  p_applies_to_all boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.ask_nac_vault_has_all_branches() then true
    when coalesce(p_applies_to_all, false) then false
    when p_branch_id is null then false
    when public.ask_nac_vault_branch_allowed(p_branch_id)
      and coalesce(p_applies_to_all, false) = false then true
    else false
  end;
$$;

comment on function public.ask_nac_external_context_can_write(text, boolean) is
  'Write: cross-branch roles only for network rows; branch users limited to their branch_id with applies_to_all_branches=false.';

-- Read competitors (no default visibility for branch_id IS NULL).
create or replace function public.ask_nac_competitors_can_read(p_branch_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.ask_nac_vault_has_all_branches() then true
    when p_branch_id is null then false
    when public.ask_nac_vault_branch_allowed(p_branch_id) then true
    else false
  end;
$$;

comment on function public.ask_nac_competitors_can_read(text) is
  'Read: branch competitors when branch allowed; network competitors (NULL branch_id) admin/cross-branch only.';

-- Map observation sensitivity to vault sensitivity matrix.
create or replace function public.ask_nac_competitor_observation_sensitivity_level(p_level text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_level, 'internal')))
    when 'confidential' then 'management'
    when 'public' then 'public'
    when 'internal' then 'internal'
    when 'management' then 'management'
    else 'internal'
  end;
$$;

create or replace function public.ask_nac_competitor_observation_can_read(
  p_branch_id text,
  p_sensitivity text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ask_nac_vault_branch_allowed(p_branch_id)
     and public.ask_nac_vault_can_read_sensitivity(
       public.ask_nac_competitor_observation_sensitivity_level(p_sensitivity)
     );
$$;

create or replace function public.ask_nac_competitor_observation_can_write(
  p_branch_id text,
  p_sensitivity text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ask_nac_external_context_can_write(p_branch_id, false)
     and public.ask_nac_vault_can_read_sensitivity(
       public.ask_nac_competitor_observation_sensitivity_level(p_sensitivity)
     )
     and (
       public.ask_nac_vault_has_all_branches()
       or lower(trim(coalesce(p_sensitivity, 'internal'))) in ('public', 'internal')
       or (
         lower(trim(coalesce(p_sensitivity, 'internal'))) = 'management'
         and public.ask_nac_vault_role() in ('branch_manager', 'ops_manager', 'ceo', 'super_admin')
       )
     );
$$;

comment on function public.ask_nac_competitor_observation_can_write(text, text) is
  'Write: branch-scoped; branch users cannot write confidential-level observations unless cross-branch.';

grant execute on function public.ask_nac_has_any_branch_access() to authenticated;
grant execute on function public.ask_nac_external_context_branch_allowed(text, boolean) to authenticated;
grant execute on function public.ask_nac_external_context_can_write(text, boolean) to authenticated;
grant execute on function public.ask_nac_competitors_can_read(text) to authenticated;
grant execute on function public.ask_nac_competitor_observation_sensitivity_level(text) to authenticated;
grant execute on function public.ask_nac_competitor_observation_can_read(text, text) to authenticated;
grant execute on function public.ask_nac_competitor_observation_can_write(text, text) to authenticated;

-- ── 7. Enable RLS ───────────────────────────────────────────────────────────

alter table public.competitors enable row level security;
alter table public.external_context_signals enable row level security;
alter table public.competitor_observations enable row level security;
alter table public.whatsapp_users enable row level security;
alter table public.whatsapp_message_logs enable row level security;

-- Competitors: branch-scoped read; network rows admin/cross-branch only.
drop policy if exists competitors_select on public.competitors;
create policy competitors_select on public.competitors
  for select to authenticated
  using (public.ask_nac_competitors_can_read(branch_id));

-- Defense-in-depth write (no authenticated INSERT grant issued below).
drop policy if exists competitors_write on public.competitors;
create policy competitors_write on public.competitors
  for all to authenticated
  using (public.ask_nac_vault_is_admin())
  with check (public.ask_nac_vault_is_admin());

-- External signals: scoped read + scoped write.
drop policy if exists external_context_signals_select on public.external_context_signals;
create policy external_context_signals_select on public.external_context_signals
  for select to authenticated
  using (
    public.ask_nac_external_context_branch_allowed(branch_id, applies_to_all_branches)
  );

drop policy if exists external_context_signals_write on public.external_context_signals;
create policy external_context_signals_write on public.external_context_signals
  for all to authenticated
  using (public.ask_nac_external_context_can_write(branch_id, applies_to_all_branches))
  with check (public.ask_nac_external_context_can_write(branch_id, applies_to_all_branches));

-- Competitor observations: branch + sensitivity.
drop policy if exists competitor_observations_select on public.competitor_observations;
create policy competitor_observations_select on public.competitor_observations
  for select to authenticated
  using (
    public.ask_nac_competitor_observation_can_read(branch_id, sensitivity_level)
  );

drop policy if exists competitor_observations_write on public.competitor_observations;
create policy competitor_observations_write on public.competitor_observations
  for all to authenticated
  using (
    public.ask_nac_competitor_observation_can_write(branch_id, sensitivity_level)
  )
  with check (
    public.ask_nac_competitor_observation_can_write(branch_id, sensitivity_level)
  );

-- WhatsApp: admin read only; webhook uses service role (bypasses RLS — enforce RBAC in Edge).
drop policy if exists whatsapp_users_admin on public.whatsapp_users;
create policy whatsapp_users_admin on public.whatsapp_users
  for select to authenticated
  using (public.ask_nac_vault_is_admin());

drop policy if exists whatsapp_message_logs_admin on public.whatsapp_message_logs;
create policy whatsapp_message_logs_admin on public.whatsapp_message_logs
  for select to authenticated
  using (public.ask_nac_vault_is_admin());

-- ── 8. Grants — SELECT only for authenticated (writes via service role) ───────
--
-- Write policies above are intentional defense-in-depth. Do NOT grant INSERT,
-- UPDATE, or DELETE on these tables to authenticated unless policies are
-- re-audited and branch scope verified.

grant select on public.competitors to authenticated;
grant select on public.external_context_signals to authenticated;
grant select on public.competitor_observations to authenticated;
grant select on public.whatsapp_users to authenticated;
grant select on public.whatsapp_message_logs to authenticated;

-- ── 9. Khobar competitor registry seed (branch-scoped, idempotent) ───────────

insert into public.competitors (name, normalized_name, branch_id, area_label, category, notes)
select v.name, v.normalized_name, v.branch_id, v.area_label, v.category, v.notes
from (
  values
    ('HOUSE OF AGAPI', 'house of agapi', 'khobar', 'Patio Mall / Khobar', 'restaurant', 'Khobar area competitor registry entry'),
    ('San Carlo Cicchetti', 'san carlo cicchetti', 'khobar', 'Khobar dining', 'restaurant', 'Khobar area competitor registry entry'),
    ('Café Lilou', 'café lilou', 'khobar', 'Khobar', 'cafe', 'Khobar area competitor registry entry'),
    ('Urth Caffé', 'urth caffé', 'khobar', 'Patio Mall', 'cafe', 'Khobar area competitor registry entry'),
    ('Patio Mall restaurants / concepts', 'patio mall restaurants / concepts', 'khobar', 'Patio Mall', 'mall_concept', 'Khobar mall concept registry entry')
) as v(name, normalized_name, branch_id, area_label, category, notes)
where not exists (
  select 1
  from public.competitors c
  where c.normalized_name = v.normalized_name
    and c.branch_id is not distinct from v.branch_id
);

-- Production apply checklist:
--   1. Apply on staging; run JWT matrix tests (Khobar GM, Riyadh GM, staff, CEO).
--   2. Confirm no authenticated INSERT grants on these tables.
--   3. When enabling collectors, use service role + explicit branch_id or applies_to_all_branches.
--   4. Plan whatsapp_message_logs retention before webhook go-live.
-- Do NOT wire Ask NAC external fetch until staging RLS verified.
