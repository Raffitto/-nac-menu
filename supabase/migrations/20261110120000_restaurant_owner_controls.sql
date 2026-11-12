-- Owner controls for guest ordering and guest payments.
-- Missing rows mean off. Hettin is not a restaurant-service branch.
-- Laysen Valley is the existing riyadh id.
-- Rollback: drop function public.restaurant_set_owner_controls(text, boolean, boolean);
--           drop table public.restaurant_owner_settings;

create table if not exists public.restaurant_owner_settings (
  branch_id text primary key,
  guest_ordering_enabled boolean not null default false,
  guest_payments_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint restaurant_owner_settings_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

comment on table public.restaurant_owner_settings is
  'Owner-only switches. Both default off. A missing row is off. Payments do not turn ordering on.';

alter table public.restaurant_owner_settings disable row level security;
grant select on public.restaurant_owner_settings to nac_restaurant_api;

create or replace function public.restaurant_set_owner_controls(
  p_branch text,
  p_ordering boolean,
  p_payments boolean
) returns public.restaurant_owner_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := public.nac_auth_email();
  branch text := public.nac_normalize_branch_id(p_branch);
  row public.restaurant_owner_settings;
begin
  if actor not in (
    'raffi@nac.com',
    'raffiazarian@gmail.com',
    'raffiazarian2@gmail.com',
    'raffi@nac-khobar.com'
  ) then
    raise exception 'owner_required';
  end if;
  if branch is null then
    raise exception 'branch_forbidden';
  end if;
  insert into public.restaurant_owner_settings (
    branch_id, guest_ordering_enabled, guest_payments_enabled, updated_at, updated_by
  ) values (
    branch, coalesce(p_ordering, false), coalesce(p_payments, false), now(), actor
  )
  on conflict (branch_id) do update set
    guest_ordering_enabled = excluded.guest_ordering_enabled,
    guest_payments_enabled = excluded.guest_payments_enabled,
    updated_at = now(),
    updated_by = actor
  returning * into row;
  perform public.restaurant_audit(branch, 'owner_controls_updated', branch, jsonb_build_object(
    'guest_ordering_enabled', row.guest_ordering_enabled,
    'guest_payments_enabled', row.guest_payments_enabled
  ));
  return row;
end;
$$;

revoke all on function public.restaurant_set_owner_controls(text, boolean, boolean) from public, anon;
grant execute on function public.restaurant_set_owner_controls(text, boolean, boolean) to authenticated, nac_restaurant_api;
