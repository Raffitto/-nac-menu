-- Fady Khobar operations, reviews-only network capability, and verified menu publishing.
-- Idempotent and branch-isolated. Existing Raffi/Ahmed grants are preserved.

-- ── Staff identity and explicit capabilities ────────────────────────────────

create table if not exists public.nac_staff_capabilities (
  email text not null,
  capability text not null,
  scope text not null,
  granted_by text,
  granted_at timestamptz not null default now(),
  primary key (email, capability)
);

alter table public.nac_staff_capabilities enable row level security;

create or replace function public.nac_has_capability(p_capability text, p_scope text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.nac_staff_capabilities c
    where lower(c.email) = public.nac_auth_email()
      and c.capability = lower(trim(p_capability))
      and (p_scope is null or c.scope = lower(trim(p_scope)))
  );
$$;

revoke all on function public.nac_has_capability(text, text) from public;
grant execute on function public.nac_has_capability(text, text) to authenticated;

drop policy if exists nac_staff_capabilities_read on public.nac_staff_capabilities;
create policy nac_staff_capabilities_read on public.nac_staff_capabilities
  for select to authenticated
  using (
    lower(email) = public.nac_auth_email()
    or public.nac_menu_staff_all_branches()
  );

grant select on public.nac_staff_capabilities to authenticated;

insert into public.menu_staff_scope (email, branch_id, role) values
  ('fady.aly@nacriyadh.com', 'khobar', 'branch_gm')
on conflict (email) do update set
  branch_id = excluded.branch_id,
  role = excluded.role,
  updated_at = now();

insert into public.ask_nac_staff (email, vault_role, primary_branch_id, menu_role_legacy) values
  ('fady.aly@nacriyadh.com', 'branch_manager', 'khobar', 'branch_gm')
on conflict (email) do update set
  vault_role = excluded.vault_role,
  primary_branch_id = excluded.primary_branch_id,
  menu_role_legacy = excluded.menu_role_legacy,
  updated_at = now();

insert into public.ask_nac_user_branch_access (email, branch_id, access_level) values
  ('fady.aly@nacriyadh.com', 'khobar', 'admin')
on conflict (email, branch_id) do update set
  access_level = excluded.access_level;

insert into public.nac_staff_capabilities (email, capability, scope, granted_by) values
  ('fady.aly@nacriyadh.com', 'google_reviews', 'network', 'production-migration')
on conflict (email, capability) do update set
  scope = excluded.scope,
  granted_by = excluded.granted_by,
  granted_at = now();

-- ── Reviews-only branch authorization ───────────────────────────────────────

create or replace function public.nac_reviews_branch_allowed(p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.nac_menu_staff_all_branches() then true
    when public.nac_has_capability('google_reviews', 'network') then true
    when public.nac_normalize_branch_id(p_branch) = (
      select s.branch_id
      from public.menu_staff_scope s
      where lower(s.email) = public.nac_auth_email()
      limit 1
    ) then true
    else false
  end;
$$;

revoke all on function public.nac_reviews_branch_allowed(text) from public;
grant execute on function public.nac_reviews_branch_allowed(text) to authenticated;

alter table if exists public.google_review_snapshots enable row level security;
drop policy if exists "anon_select_google_review_snapshots" on public.google_review_snapshots;
drop policy if exists "auth_full_google_review_snapshots" on public.google_review_snapshots;
drop policy if exists google_review_snapshots_scoped_select on public.google_review_snapshots;
drop policy if exists google_review_snapshots_scoped_insert on public.google_review_snapshots;
drop policy if exists google_review_snapshots_scoped_update on public.google_review_snapshots;

create policy google_review_snapshots_scoped_select on public.google_review_snapshots
  for select to authenticated
  using (public.nac_reviews_branch_allowed(branch_id));

create policy google_review_snapshots_scoped_insert on public.google_review_snapshots
  for insert to authenticated
  with check (public.nac_reviews_branch_allowed(branch_id));

create policy google_review_snapshots_scoped_update on public.google_review_snapshots
  for update to authenticated
  using (public.nac_reviews_branch_allowed(branch_id))
  with check (public.nac_reviews_branch_allowed(branch_id));

revoke all on public.google_review_snapshots from anon;
grant select, insert, update on public.google_review_snapshots to authenticated;

alter table public.review_events enable row level security;
drop policy if exists "authenticated_select_review_events" on public.review_events;
drop policy if exists review_events_auth_select on public.review_events;
drop policy if exists review_events_scoped_select on public.review_events;
create policy review_events_scoped_select on public.review_events
  for select to authenticated
  using (public.nac_reviews_branch_allowed(branch_id));

-- Security-definer review RPCs must apply the same scope as direct table reads.
create or replace function public.get_review_events_summary(
  p_branch text default null,
  p_hours int default 24
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with bounds as (select public.nac_filter_since(p_hours) as since_ts),
  filtered as (
    select e.event_type, e.branch_id, e.employee_name, e.employee_role, e.created_at,
      e.review_session_id, e.session_id
    from public.review_events e, bounds b
    where (coalesce(p_hours, 0) = 0 or e.created_at >= b.since_ts)
      and (p_branch is null or e.branch_id = lower(trim(p_branch)))
      and public.nac_reviews_branch_allowed(e.branch_id)
  ),
  by_type as (select event_type, count(*)::int as c from filtered group by 1),
  staff as (
    select coalesce(nullif(trim(employee_name), ''), '') as name,
      max(employee_role) as role,
      count(*) filter (where event_type = 'qr_scan') as scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate')) as generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect')) as google
    from filtered
    where coalesce(trim(employee_name), '') <> ''
    group by 1
  ),
  daily as (
    select (created_at at time zone 'Asia/Riyadh')::date as day_key,
      count(*) filter (where event_type = 'qr_scan')::int as scans
    from filtered group by 1
  ),
  branches as (
    select branch_id,
      count(*) filter (where event_type = 'qr_scan')::int as qr_scans,
      count(*) filter (where event_type in ('review_generate', 'review_regenerate'))::int as reviews_generated,
      count(*) filter (where event_type in ('review_google_click', 'google_redirect'))::int as google_redirects,
      count(*) filter (where event_type in ('review_page_open', 'review_open'))::int as review_page_opens
    from filtered
    where coalesce(trim(branch_id), '') <> ''
    group by 1
  )
  select jsonb_build_object(
    'qr_scans', coalesce((select sum(c) from by_type where event_type = 'qr_scan'), 0),
    'reviews_generated', coalesce((select sum(c) from by_type where event_type in ('review_generate', 'review_regenerate')), 0),
    'google_redirects', coalesce((select sum(c) from by_type where event_type in ('review_google_click', 'google_redirect')), 0),
    'review_page_opens', coalesce((select sum(c) from by_type where event_type in ('review_page_open', 'review_open')), 0),
    'conversion_pct', case
      when coalesce((select sum(c) from by_type where event_type = 'qr_scan'), 0) > 0
      then round(100.0 * coalesce((select sum(c) from by_type where event_type in ('review_google_click', 'google_redirect')), 0)
        / greatest((select sum(c) from by_type where event_type = 'qr_scan'), 1))
      else 0 end,
    'unique_visitors', coalesce((
      select count(distinct coalesce(nullif(trim(review_session_id), ''), nullif(trim(session_id), '')))::int
      from filtered
      where coalesce(nullif(trim(review_session_id), ''), nullif(trim(session_id), '')) is not null
    ), 0),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name, 'role', role, 'scans', scans, 'generated', generated, 'google', google,
        'conversion_pct', case when scans > 0 then round(100.0 * google / scans) else 0 end
      ) order by scans desc, google desc) from staff
    ), '[]'::jsonb),
    'daily_trend', coalesce((
      select jsonb_agg(jsonb_build_object('date', day_key::text, 'scans', scans) order by day_key)
      from daily
    ), '[]'::jsonb),
    'by_branch', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch_id', branch_id, 'qr_scans', qr_scans, 'reviews_generated', reviews_generated,
        'google_redirects', google_redirects, 'review_page_opens', review_page_opens,
        'conversion_pct', case when qr_scans > 0 then round(100.0 * google_redirects / qr_scans) else 0 end
      ) order by branch_id) from branches
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_review_intelligence(
  p_branch text default null,
  p_hours int default 24
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with filtered as (
    select *
    from public.review_events e
    where (p_branch is null or e.branch_id = lower(trim(p_branch)))
      and (coalesce(p_hours, 0) = 0 or e.created_at >= public.nac_filter_since(p_hours))
      and public.nac_reviews_branch_allowed(e.branch_id)
  ),
  by_type as (
    select event_type, count(*)::int as c from filtered group by event_type
  ),
  employees as (
    select coalesce(employee_name, 'Unknown') as name,
      coalesce(employee_role, '') as role,
      count(*) filter (where event_type = 'review_page_open') as opens,
      count(*) filter (where event_type = 'review_generate') as generated,
      count(*) filter (where event_type = 'review_google_click') as google_clicks,
      avg(generated_text_length) filter (where event_type in ('review_generate', 'review_regenerate')) as avg_length
    from filtered
    where coalesce(trim(employee_name), '') <> ''
    group by 1, 2
  )
  select jsonb_build_object(
    'total_events', (select count(*)::int from filtered),
    'by_event_type', coalesce((select jsonb_object_agg(event_type, c) from by_type), '{}'::jsonb),
    'review_sessions', (select count(distinct review_session_id)::int from filtered),
    'google_clicks', coalesce((select c from by_type where event_type = 'review_google_click'), 0),
    'reviews_generated', coalesce((select c from by_type where event_type = 'review_generate'), 0),
    'conversion_pct', case
      when coalesce((select c from by_type where event_type = 'review_generate'), 0) > 0
      then round(100.0 * coalesce((select c from by_type where event_type = 'review_google_click'), 0)
        / greatest((select c from by_type where event_type = 'review_generate'), 1))
      else 0 end,
    'top_employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name, 'role', role, 'opens', opens, 'generated', generated,
        'google_clicks', google_clicks, 'avg_length', round(avg_length::numeric, 0),
        'conversion_pct', case when generated > 0 then round(100.0 * google_clicks / generated) else 0 end
      ) order by generated desc nulls last) from employees
    ), '[]'::jsonb),
    'business_day_key', public.nac_business_day_key()::text
  );
$$;

revoke all on function public.get_review_events_summary(text, int) from public, anon;
revoke all on function public.get_review_intelligence(text, int) from public, anon;
grant execute on function public.get_review_events_summary(text, int) to authenticated;
grant execute on function public.get_review_intelligence(text, int) to authenticated;

-- ── Immutable menu publication history and audit ────────────────────────────

create table if not exists public.menu_publications (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  version bigint not null,
  status text not null default 'publishing'
    check (status in ('publishing', 'live', 'failed')),
  actor_id uuid,
  actor_email text not null,
  idempotency_key text,
  change_summary jsonb not null default '{}'::jsonb,
  snapshot jsonb not null,
  snapshot_fingerprint text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  guest_verified_at timestamptz,
  verification_result jsonb not null default '{}'::jsonb,
  restored_from_publication_id uuid references public.menu_publications(id),
  unique (branch_id, version),
  unique (branch_id, idempotency_key)
);

create index if not exists idx_menu_publications_branch_created
  on public.menu_publications (branch_id, created_at desc);

create table if not exists public.menu_audit_log (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid references public.menu_publications(id) on delete set null,
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  actor_id uuid,
  actor_email text not null,
  action text not null,
  entity_type text,
  entity_id text,
  changed_fields jsonb not null default '{}'::jsonb,
  publication_version bigint,
  result text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_menu_audit_branch_created
  on public.menu_audit_log (branch_id, created_at desc);

alter table public.menu_publications enable row level security;
alter table public.menu_audit_log enable row level security;

drop policy if exists menu_publications_scoped_read on public.menu_publications;
create policy menu_publications_scoped_read on public.menu_publications
  for select to authenticated
  using (public.nac_menu_can_edit_branch(branch_id));

drop policy if exists menu_audit_scoped_read on public.menu_audit_log;
create policy menu_audit_scoped_read on public.menu_audit_log
  for select to authenticated
  using (public.nac_menu_can_edit_branch(branch_id));

grant select on public.menu_publications, public.menu_audit_log to authenticated;

create or replace function public.nac_menu_branch_snapshot(p_branch text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'branch_id', public.nac_normalize_branch_id(p_branch),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.id)
      from public.categories c
      where c.branch_id = public.nac_normalize_branch_id(p_branch)
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.id)
      from public.sections s
      where s.branch_id = public.nac_normalize_branch_id(p_branch)
    ), '[]'::jsonb),
    'menu_items', coalesce((
      select jsonb_agg(to_jsonb(mi) order by mi.id)
      from public.menu_items mi
      where mi.branch_id = public.nac_normalize_branch_id(p_branch)
    ), '[]'::jsonb),
    'item_addons', coalesce((
      select jsonb_agg(to_jsonb(ia) order by ia.item_id, ia.addon_id)
      from public.item_addons ia
      join public.menu_items mi on mi.id = ia.item_id
      where mi.branch_id = public.nac_normalize_branch_id(p_branch)
    ), '[]'::jsonb),
    'item_allergens', coalesce((
      select jsonb_agg(to_jsonb(ial) order by ial.item_id, ial.allergen_id)
      from public.item_allergens ial
      join public.menu_items mi on mi.id = ial.item_id
      where mi.branch_id = public.nac_normalize_branch_id(p_branch)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.nac_menu_branch_snapshot(text) from public, anon, authenticated;

create or replace function public.publish_menu_branch(
  p_branch text,
  p_change_summary jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := public.nac_normalize_branch_id(p_branch);
  v_snapshot jsonb;
  v_fingerprint text;
  v_existing public.menu_publications%rowtype;
  v_latest public.menu_publications%rowtype;
  v_row public.menu_publications%rowtype;
  v_version bigint;
  v_email text := public.nac_auth_email();
begin
  if v_branch is null or not public.nac_menu_can_edit_branch(v_branch) then
    raise exception 'Menu publish access denied for branch %', coalesce(p_branch, '');
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from public.menu_publications
    where branch_id = v_branch and idempotency_key = p_idempotency_key;
    if found then
      return to_jsonb(v_existing);
    end if;
  end if;

  v_snapshot := public.nac_menu_branch_snapshot(v_branch);
  v_fingerprint := md5(v_snapshot::text);

  select * into v_latest
  from public.menu_publications
  where branch_id = v_branch and status = 'live'
  order by version desc
  limit 1;

  if found and v_latest.snapshot_fingerprint = v_fingerprint then
    return to_jsonb(v_latest) || jsonb_build_object('idempotent', true);
  end if;

  v_version := coalesce(v_latest.version, 0) + 1;
  insert into public.menu_publications (
    branch_id, version, status, actor_id, actor_email, idempotency_key,
    change_summary, snapshot, snapshot_fingerprint, published_at
  ) values (
    v_branch, v_version, 'publishing', auth.uid(), v_email, p_idempotency_key,
    coalesce(p_change_summary, '{}'::jsonb), v_snapshot, v_fingerprint, now()
  )
  returning * into v_row;

  insert into public.menu_audit_log (
    publication_id, branch_id, actor_id, actor_email, action, entity_type,
    entity_id, changed_fields, publication_version, result
  ) values (
    v_row.id, v_branch, auth.uid(), v_email,
    coalesce(p_change_summary ->> 'action', 'publish'),
    p_change_summary ->> 'entity_type', p_change_summary ->> 'entity_id',
    coalesce(p_change_summary -> 'changed_fields', p_change_summary),
    v_version, 'publishing'
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.verify_menu_publication(p_publication_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.menu_publications%rowtype;
  v_live_fingerprint text;
begin
  select * into v_row from public.menu_publications where id = p_publication_id;
  if not found then raise exception 'Menu publication not found'; end if;
  if not public.nac_menu_can_edit_branch(v_row.branch_id) then
    raise exception 'Menu verification access denied';
  end if;

  v_live_fingerprint := md5(public.nac_menu_branch_snapshot(v_row.branch_id)::text);
  if v_live_fingerprint <> v_row.snapshot_fingerprint then
    update public.menu_publications
    set status = 'failed',
        verification_result = jsonb_build_object(
          'verified', false,
          'expected_fingerprint', v_row.snapshot_fingerprint,
          'guest_fingerprint', v_live_fingerprint,
          'reason', 'Guest menu source changed before verification'
        )
    where id = v_row.id
    returning * into v_row;
  else
    update public.menu_publications
    set status = 'live',
        guest_verified_at = now(),
        verification_result = jsonb_build_object(
          'verified', true,
          'guest_fingerprint', v_live_fingerprint
        )
    where id = v_row.id
    returning * into v_row;
  end if;

  update public.menu_audit_log
  set result = v_row.status
  where publication_id = v_row.id and result = 'publishing';

  return to_jsonb(v_row);
end;
$$;

create or replace function public.get_menu_publish_status(p_branch text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_branch text := public.nac_normalize_branch_id(p_branch);
  v_latest public.menu_publications%rowtype;
  v_current text;
  v_pending boolean;
begin
  if v_branch is null or not public.nac_menu_can_edit_branch(v_branch) then
    raise exception 'Menu status access denied';
  end if;
  v_current := md5(public.nac_menu_branch_snapshot(v_branch)::text);
  select * into v_latest
  from public.menu_publications
  where branch_id = v_branch and status = 'live'
  order by version desc limit 1;
  v_pending := not found or v_latest.snapshot_fingerprint <> v_current;
  return jsonb_build_object(
    'branch_id', v_branch,
    'menu_status', case when v_pending then 'publish_failed' else 'live' end,
    'database_version', coalesce(v_latest.version, 0) + case when v_pending then 1 else 0 end,
    'guest_version', coalesce(v_latest.version, 0),
    'published_version', coalesce(v_latest.version, 0),
    'last_published_at', v_latest.guest_verified_at,
    'publishing_user', v_latest.actor_email,
    'sync_status', case when v_pending then 'needs_publish' else 'healthy' end,
    'current_fingerprint', v_current,
    'guest_fingerprint', v_latest.snapshot_fingerprint,
    'live_menu_path', case when v_branch = 'khobar' then '/khobar' else '/' || v_branch end
  );
end;
$$;

create or replace function public.restore_menu_publication(
  p_publication_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.menu_publications%rowtype;
  v_publish jsonb;
  v_verified jsonb;
begin
  select * into v_source
  from public.menu_publications
  where id = p_publication_id and status = 'live';
  if not found then raise exception 'Live menu publication not found'; end if;
  if not public.nac_menu_can_edit_branch(v_source.branch_id) then
    raise exception 'Menu restore access denied';
  end if;

  delete from public.categories where branch_id = v_source.branch_id;
  insert into public.categories
    select * from jsonb_populate_recordset(null::public.categories, v_source.snapshot -> 'categories');
  insert into public.sections
    select * from jsonb_populate_recordset(null::public.sections, v_source.snapshot -> 'sections');
  insert into public.menu_items
    select * from jsonb_populate_recordset(null::public.menu_items, v_source.snapshot -> 'menu_items');
  insert into public.item_addons
    select * from jsonb_populate_recordset(null::public.item_addons, v_source.snapshot -> 'item_addons');
  insert into public.item_allergens
    select * from jsonb_populate_recordset(null::public.item_allergens, v_source.snapshot -> 'item_allergens');

  v_publish := public.publish_menu_branch(
    v_source.branch_id,
    jsonb_build_object(
      'action', 'restore',
      'entity_type', 'menu',
      'entity_id', v_source.branch_id,
      'changed_fields', jsonb_build_object('restored_from_version', v_source.version)
    ),
    coalesce(p_idempotency_key, 'restore:' || p_publication_id::text || ':' || txid_current()::text)
  );

  update public.menu_publications
  set restored_from_publication_id = p_publication_id
  where id = (v_publish ->> 'id')::uuid;

  v_verified := public.verify_menu_publication((v_publish ->> 'id')::uuid);
  return v_verified;
end;
$$;

revoke all on function public.publish_menu_branch(text, jsonb, text) from public, anon;
revoke all on function public.verify_menu_publication(uuid) from public, anon;
revoke all on function public.get_menu_publish_status(text) from public, anon;
revoke all on function public.restore_menu_publication(uuid, text) from public, anon;
grant execute on function public.publish_menu_branch(text, jsonb, text) to authenticated;
grant execute on function public.verify_menu_publication(uuid) to authenticated;
grant execute on function public.get_menu_publish_status(text) to authenticated;
grant execute on function public.restore_menu_publication(uuid, text) to authenticated;

