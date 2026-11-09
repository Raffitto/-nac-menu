-- Local development passkeys and grant revocation.
-- Stores WebAuthn credential ids and public keys only.
-- Biometric templates, PINs, and fingerprints are not stored.
-- Rollback: drop table public.restaurant_passkeys;
--           alter table public.restaurant_staff_grants drop column if exists revoked_at;

alter table public.restaurant_staff_grants
  add column if not exists revoked_at timestamptz;

create table if not exists public.restaurant_passkeys (
  credential_id text primary key,
  email text not null,
  public_key bytea not null,
  counter bigint not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.restaurant_passkeys is
  'Local development WebAuthn public keys. Biometric templates are not stored.';

alter table public.restaurant_passkeys disable row level security;
grant select, insert, update on public.restaurant_passkeys to nac_restaurant_api;
