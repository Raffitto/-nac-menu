-- Internal restaurant pilot. Default off. Does not enable guest ordering or payments.
-- Rollback: drop function public.restaurant_set_pilot_mode(text, boolean);
--           alter table public.restaurant_owner_settings drop column if exists restaurant_pilot_enabled;

alter table public.restaurant_owner_settings
  add column if not exists restaurant_pilot_enabled boolean not null default false;

create or replace function public.restaurant_set_pilot_mode(
  p_branch text,
  p_enabled boolean
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
    branch_id, guest_ordering_enabled, guest_payments_enabled, restaurant_pilot_enabled, updated_at, updated_by
  ) values (
    branch, false, false, coalesce(p_enabled, false), now(), actor
  )
  on conflict (branch_id) do update set
    restaurant_pilot_enabled = excluded.restaurant_pilot_enabled,
    updated_at = now(),
    updated_by = actor
  returning * into row;
  perform public.restaurant_audit(branch, 'restaurant_pilot_updated', branch, jsonb_build_object(
    'restaurant_pilot_enabled', row.restaurant_pilot_enabled,
    'guest_ordering_enabled', row.guest_ordering_enabled,
    'guest_payments_enabled', row.guest_payments_enabled
  ));
  return row;
end;
$$;

revoke all on function public.restaurant_set_pilot_mode(text, boolean) from public, anon;
grant execute on function public.restaurant_set_pilot_mode(text, boolean) to authenticated, nac_restaurant_api;
