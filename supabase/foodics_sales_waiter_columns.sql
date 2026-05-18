-- Waiter / timestamp columns for transactional sales correlation
-- Run in Supabase SQL Editor after foodics_import_schema.sql

alter table public.foodics_sales_items
  add column if not exists waiter_name text,
  add column if not exists sold_at timestamptz;

create index if not exists idx_foodics_sales_waiter on public.foodics_sales_items (waiter_name);
create index if not exists idx_foodics_sales_sold_at on public.foodics_sales_items (sold_at desc);
