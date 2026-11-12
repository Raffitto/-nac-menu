-- LOCAL DEVELOPMENT ACCESS ONLY.
-- Do not apply this file to production Supabase.
-- It creates a non-superuser API role with no password and a local session table.
-- The password is set by scripts/local-restaurant/migrate.sh from the environment.
-- Rollback: drop table public.restaurant_dev_sessions;
--           drop owned by nac_restaurant_api;
--           drop role if exists nac_restaurant_api;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nac_restaurant_api') then
    create role nac_restaurant_api login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

do $$
begin
  execute format('grant connect on database %I to nac_restaurant_api', current_database());
end $$;

grant usage on schema public to nac_restaurant_api;
grant select on all tables in schema public to nac_restaurant_api;
grant execute on all functions in schema public to nac_restaurant_api;

create table if not exists public.restaurant_dev_sessions (
  token_hash text primary key,
  email text not null,
  role text not null,
  branch_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_dev_sessions disable row level security;
grant select, insert, update on public.restaurant_dev_sessions to nac_restaurant_api;

do $$
declare
  table_name text;
  predicate text;
begin
  for table_name in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'branch_id'
      and c.table_name like 'restaurant_%'
      and c.table_name <> 'restaurant_dev_sessions'
  loop
    predicate := case
      when table_name = 'restaurant_staff_grants' then 'true'
      else 'branch_id = current_setting(''nac.branch'', true)'
    end;
    execute format('drop policy if exists restaurant_api_read on public.%I', table_name);
    execute format(
      'create policy restaurant_api_read on public.%I for select to nac_restaurant_api using (%s)',
      table_name,
      predicate
    );
  end loop;
end $$;

drop policy if exists restaurant_api_read on public.restaurant_session_tables;
create policy restaurant_api_read on public.restaurant_session_tables
  for select to nac_restaurant_api
  using (exists (
    select 1 from public.restaurant_sessions s
    where s.id = session_id and s.branch_id = current_setting('nac.branch', true)
  ));
