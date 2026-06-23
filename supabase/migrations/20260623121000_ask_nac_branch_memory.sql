-- Ask NAC P1: branch-specific operational memory for executive intelligence.

create table if not exists public.ask_nac_branch_memory (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  category text not null check (category in (
    'policy', 'capacity', 'demand_driver', 'spend', 'competitive', 'operational', 'general'
  )),
  fact text not null,
  priority int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ask_nac_branch_memory_branch_active
  on public.ask_nac_branch_memory (branch_id, active, priority);

comment on table public.ask_nac_branch_memory is
  'Branch-specific operational knowledge retrieved by Ask NAC before reasoning.';

alter table public.ask_nac_branch_memory enable row level security;

drop policy if exists ask_nac_branch_memory_select on public.ask_nac_branch_memory;
create policy ask_nac_branch_memory_select on public.ask_nac_branch_memory
  for select to authenticated
  using (public.ask_nac_vault_branch_allowed(branch_id));

grant select on public.ask_nac_branch_memory to authenticated;

-- Khobar operational memory (seed — extend per branch as needed)
insert into public.ask_nac_branch_memory (branch_id, category, fact, priority)
select v.branch_id, v.category, v.fact, v.priority
from (values
  ('khobar', 'policy', 'Kids not allowed after 7pm.', 10),
  ('khobar', 'competitive', 'Patio Mall football screen impacts walk-in traffic during major matches.', 20),
  ('khobar', 'demand_driver', 'Humidity strongly impacts walk-in traffic.', 15),
  ('khobar', 'demand_driver', 'Ithra events influence demand in the Khobar area.', 25),
  ('khobar', 'demand_driver', 'Aramco events influence demand in the Khobar area.', 25),
  ('khobar', 'capacity', 'Restaurant capacity is approximately 110 seats.', 30),
  ('khobar', 'spend', 'Typical average spend range is tracked via daily cash-up uploads.', 40)
) as v(branch_id, category, fact, priority)
where not exists (
  select 1 from public.ask_nac_branch_memory m
  where m.branch_id = v.branch_id and m.fact = v.fact
);
