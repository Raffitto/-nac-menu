-- Short-lived guest ordering access for a local dining session.
-- A token expires and can be revoked. It does not capture a payment.
-- Rollback: drop table public.restaurant_guest_submissions;
--           drop table public.restaurant_guest_baskets;
--           drop table public.restaurant_guest_access;

create table if not exists public.restaurant_guest_access (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null,
  session_id text not null,
  table_id text not null,
  label text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint restaurant_guest_access_branch_check
    check (branch_id = public.nac_normalize_branch_id(branch_id))
);

create table if not exists public.restaurant_guest_baskets (
  id uuid primary key default gen_random_uuid(),
  access_id uuid not null references public.restaurant_guest_access(id),
  item_id text not null,
  item_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  modifier_ids jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_staff', 'confirmed', 'rejected')),
  client_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists restaurant_guest_baskets_client_key
  on public.restaurant_guest_baskets (access_id, client_key)
  where client_key is not null;

create table if not exists public.restaurant_guest_submissions (
  id uuid primary key default gen_random_uuid(),
  access_id uuid not null references public.restaurant_guest_access(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (access_id, idempotency_key)
);

comment on table public.restaurant_guest_access is
  'Local guest QR access. A copied token expires and can be revoked. It does not prove someone is standing at the table.';

alter table public.restaurant_guest_access disable row level security;
alter table public.restaurant_guest_baskets disable row level security;
alter table public.restaurant_guest_submissions disable row level security;
grant select, insert, update on public.restaurant_guest_access to nac_restaurant_api;
grant select, insert, update on public.restaurant_guest_baskets to nac_restaurant_api;
grant select, insert on public.restaurant_guest_submissions to nac_restaurant_api;
