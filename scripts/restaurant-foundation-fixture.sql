-- Isolated fixture matching production main helpers. Not a migration.
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

create table if not exists public.menu_staff_scope (
  email text primary key,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  role text not null default 'branch_gm' check (role in ('developer', 'ceo', 'branch_gm', 'restricted')),
  updated_at timestamptz not null default now()
);

create or replace function public.nac_normalize_branch_id(p text)
returns text language sql immutable as $$
  select case
    when p is null or trim(p) = '' then null
    when lower(trim(p)) in ('khobar', 'riyadh', 'jeddah') then lower(trim(p))
    when lower(trim(p)) ~ '(khobar|alkhobar|الخبر)' then 'khobar'
    when lower(trim(p)) ~ '(riyadh|رياض)' then 'riyadh'
    when lower(trim(p)) ~ '(jeddah|jedda|جدة|jiddah)' then 'jeddah'
    else null
  end;
$$;

create or replace function public.nac_auth_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(trim(coalesce(nullif(current_setting('request.jwt.claim.email', true), ''), '')));
$$;

create or replace function public.nac_menu_staff_all_branches()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.menu_staff_scope s
    where lower(s.email) = public.nac_auth_email()
      and s.branch_id is null
      and s.role in ('developer', 'ceo')
  );
$$;

create or replace function public.nac_menu_staff_branch()
returns text language sql stable security definer set search_path = public as $$
  select s.branch_id from public.menu_staff_scope s
  where lower(s.email) = public.nac_auth_email()
  limit 1;
$$;

create or replace function public.nac_menu_can_edit_branch(p_branch text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.nac_menu_staff_all_branches() then true
    when public.nac_normalize_branch_id(p_branch) = public.nac_menu_staff_branch() then true
    else false
  end;
$$;

insert into public.menu_staff_scope (email, branch_id, role) values
  ('host.khobar@nac.test', 'khobar', 'branch_gm'),
  ('host.riyadh@nac.test', 'riyadh', 'branch_gm'),
  ('outsider@nac.test', 'jeddah', 'restricted')
on conflict (email) do nothing;
