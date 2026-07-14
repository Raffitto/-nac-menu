-- Statement-stable review scope avoids a capability lookup for every review row.

create or replace function public.nac_reviews_allowed_branches()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.nac_menu_staff_all_branches()
      or public.nac_has_capability('google_reviews', 'network')
      then array['khobar', 'riyadh', 'jeddah']::text[]
    else coalesce((
      select array_agg(s.branch_id)
      from public.menu_staff_scope s
      where lower(s.email) = public.nac_auth_email()
        and s.branch_id is not null
    ), '{}'::text[])
  end;
$$;

create or replace function public.nac_reviews_branch_allowed(p_branch text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.nac_normalize_branch_id(p_branch)
    = any(public.nac_reviews_allowed_branches());
$$;

revoke all on function public.nac_reviews_allowed_branches() from public;
grant execute on function public.nac_reviews_allowed_branches() to authenticated;

drop policy if exists google_review_snapshots_scoped_select on public.google_review_snapshots;
create policy google_review_snapshots_scoped_select on public.google_review_snapshots
  for select to authenticated
  using (branch_id = any(public.nac_reviews_allowed_branches()));

drop policy if exists google_review_snapshots_scoped_insert on public.google_review_snapshots;
create policy google_review_snapshots_scoped_insert on public.google_review_snapshots
  for insert to authenticated
  with check (branch_id = any(public.nac_reviews_allowed_branches()));

drop policy if exists google_review_snapshots_scoped_update on public.google_review_snapshots;
create policy google_review_snapshots_scoped_update on public.google_review_snapshots
  for update to authenticated
  using (branch_id = any(public.nac_reviews_allowed_branches()))
  with check (branch_id = any(public.nac_reviews_allowed_branches()));

drop policy if exists review_events_scoped_select on public.review_events;
create policy review_events_scoped_select on public.review_events
  for select to authenticated
  using (branch_id = any(public.nac_reviews_allowed_branches()));

