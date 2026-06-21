-- =============================================================================
-- External Context Intelligence + WhatsApp foundation (schema only)
-- Safe to re-run (idempotent). NOT applied to production automatically.
-- No live API collectors. No WhatsApp webhook in this migration.
-- Reuses ask_nac_vault_branch_allowed / ask_nac_vault_is_admin for RLS.
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

create unique index if not exists idx_competitors_normalized_branch
  on public.competitors (normalized_name, branch_id);

create index if not exists idx_competitors_branch_active
  on public.competitors (branch_id, is_active);

comment on table public.competitors is
  'Configurable competitor registry per branch/area. Referenced by observations and external signals — not hardcoded in NIL.';

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
  constraint external_context_signals_scope check (
    applies_to_all_branches = true or branch_id is not null or signal_type in ('macro', 'public_holiday')
  )
);

create index if not exists idx_external_context_signals_branch_date
  on public.external_context_signals (branch_id, signal_date desc);

create index if not exists idx_external_context_signals_type_date
  on public.external_context_signals (signal_type, signal_date desc);

create index if not exists idx_external_context_signals_window
  on public.external_context_signals (start_at, end_at);

comment on table public.external_context_signals is
  'Universal external context store for NIL adapters. API ingestion writes here later.';

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

comment on table public.competitor_observations is
  'Manual or imported competitor traffic/activity notes. Never auto-invented by Ask NAC.';

-- ── 4. WhatsApp allowlist (foundation — no webhook yet) ─────────────────────

create table if not exists public.whatsapp_users (
  id uuid primary key default gen_random_uuid(),
  phone_number_e164 text not null unique check (phone_number_e164 ~ '^\+[1-9]\d{1,14}$'),
  display_name text,
  linked_user_id uuid,
  linked_email text,
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
  last_seen_at timestamptz
);

create index if not exists idx_whatsapp_users_active on public.whatsapp_users (is_active);

comment on table public.whatsapp_users is
  'WhatsApp allowlist mapping E.164 phone → vault role and branch scope. Webhook uses service role.';

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

comment on table public.whatsapp_message_logs is
  'Inbound/outbound WhatsApp audit trail. Inserts from future webhook (service role).';

-- ── 6. RLS helper: external context branch read ─────────────────────────────

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
    when coalesce(p_applies_to_all, false) and public.ask_nac_vault_has_all_branches() then true
    when public.ask_nac_vault_branch_allowed(p_branch_id) then true
    else false
  end;
$$;

grant execute on function public.ask_nac_external_context_branch_allowed(text, boolean) to authenticated;

-- ── 7. Enable RLS ───────────────────────────────────────────────────────────

alter table public.competitors enable row level security;
alter table public.external_context_signals enable row level security;
alter table public.competitor_observations enable row level security;
alter table public.whatsapp_users enable row level security;
alter table public.whatsapp_message_logs enable row level security;

-- Competitors: read if branch allowed or network-wide row
drop policy if exists competitors_select on public.competitors;
create policy competitors_select on public.competitors
  for select to authenticated
  using (
    public.ask_nac_vault_has_all_branches()
    or branch_id is null
    or public.ask_nac_vault_branch_allowed(branch_id)
  );

drop policy if exists competitors_write on public.competitors;
create policy competitors_write on public.competitors
  for all to authenticated
  using (public.ask_nac_vault_is_admin())
  with check (public.ask_nac_vault_is_admin());

-- External signals
drop policy if exists external_context_signals_select on public.external_context_signals;
create policy external_context_signals_select on public.external_context_signals
  for select to authenticated
  using (
    public.ask_nac_external_context_branch_allowed(branch_id, applies_to_all_branches)
  );

drop policy if exists external_context_signals_write on public.external_context_signals;
create policy external_context_signals_write on public.external_context_signals
  for all to authenticated
  using (public.ask_nac_vault_is_admin() or public.ask_nac_vault_can_upload())
  with check (public.ask_nac_vault_is_admin() or public.ask_nac_vault_can_upload());

-- Competitor observations
drop policy if exists competitor_observations_select on public.competitor_observations;
create policy competitor_observations_select on public.competitor_observations
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

drop policy if exists competitor_observations_write on public.competitor_observations;
create policy competitor_observations_write on public.competitor_observations
  for all to authenticated
  using (
    public.ask_nac_vault_branch_allowed(branch_id)
    and (public.ask_nac_vault_can_upload() or public.ask_nac_vault_role() in ('branch_manager', 'ops_manager'))
  )
  with check (
    public.ask_nac_vault_branch_allowed(branch_id)
    and (public.ask_nac_vault_can_upload() or public.ask_nac_vault_role() in ('branch_manager', 'ops_manager'))
  );

-- WhatsApp tables: admin read; no authenticated write (webhook service role later)
drop policy if exists whatsapp_users_admin on public.whatsapp_users;
create policy whatsapp_users_admin on public.whatsapp_users
  for select to authenticated
  using (public.ask_nac_vault_is_admin());

drop policy if exists whatsapp_message_logs_admin on public.whatsapp_message_logs;
create policy whatsapp_message_logs_admin on public.whatsapp_message_logs
  for select to authenticated
  using (public.ask_nac_vault_is_admin());

-- ── 8. Grants ─────────────────────────────────────────────────────────────────

grant select on public.competitors to authenticated;
grant select on public.external_context_signals to authenticated;
grant select on public.competitor_observations to authenticated;
grant select on public.whatsapp_users to authenticated;
grant select on public.whatsapp_message_logs to authenticated;

-- ── 9. Dev registry seed — Khobar competitors (reference only, idempotent) ───

insert into public.competitors (name, normalized_name, branch_id, area_label, category, notes) values
  ('HOUSE OF AGAPI', 'house of agapi', 'khobar', 'Patio Mall / Khobar', 'restaurant', 'Registry seed — dev/reference'),
  ('San Carlo Cicchetti', 'san carlo cicchetti', 'khobar', 'Khobar dining', 'restaurant', 'Registry seed — dev/reference'),
  ('Café Lilou', 'café lilou', 'khobar', 'Khobar', 'cafe', 'Registry seed — dev/reference'),
  ('Urth Caffé', 'urth caffé', 'khobar', 'Patio Mall', 'cafe', 'Registry seed — dev/reference'),
  ('Patio Mall restaurants / concepts', 'patio mall restaurants / concepts', 'khobar', 'Patio Mall', 'mall_concept', 'Aggregate mall concepts — registry seed')
on conflict (normalized_name, branch_id) do nothing;

-- Manual follow-up: apply migration via supabase db push (non-prod first).
-- Do NOT wire external signals into Ask NAC answers until collectors + adapter fetch exist.
