-- Synthetic local data only. Not production guests or a real floor survey.
insert into public.menu_staff_scope (email, branch_id, role) values
  ('host.khobar@nac.test', 'khobar', 'branch_gm'),
  ('waiter.khobar@nac.test', 'khobar', 'branch_gm'),
  ('kitchen.khobar@nac.test', 'khobar', 'branch_gm'),
  ('cashier.khobar@nac.test', 'khobar', 'branch_gm'),
  ('host.riyadh@nac.test', 'riyadh', 'branch_gm'),
  ('manager.khobar@nac.test', 'khobar', 'branch_gm')
on conflict (email) do nothing;

insert into public.restaurant_staff_grants (email, branch_id, role) values
  ('host.khobar@nac.test', 'khobar', 'host'),
  ('waiter.khobar@nac.test', 'khobar', 'waiter'),
  ('kitchen.khobar@nac.test', 'khobar', 'kitchen'),
  ('cashier.khobar@nac.test', 'khobar', 'cashier'),
  ('host.riyadh@nac.test', 'riyadh', 'host'),
  ('manager.khobar@nac.test', 'khobar', 'manager')
on conflict do nothing;

insert into public.restaurant_tables (id, branch_id, label) values
  ('khobar:12', 'khobar', '12'),
  ('khobar:22', 'khobar', '22'),
  ('khobar:23', 'khobar', '23'),
  ('khobar:24', 'khobar', '24')
on conflict (id) do nothing;

insert into public.restaurant_floor_layouts (id, branch_id, name, status, document, created_by)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'khobar', 'Synthetic Khobar service tables', 'published',
  '{"synthetic":true,"note":"Ids only. Coordinates stay in the photographed Khobar floor. Capacities are not set.","tables":[{"id":"khobar:12","label":"12"},{"id":"khobar:22","label":"22"},{"id":"khobar:23","label":"23"},{"id":"khobar:24","label":"24"}]}'::jsonb,
  'local-setup'
where not exists (
  select 1 from public.restaurant_floor_layouts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);
