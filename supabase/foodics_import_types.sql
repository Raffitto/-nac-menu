-- Foodics dual import lanes (run in Supabase SQL editor — safe, additive only)
-- product_sales: branch product report
-- waiter_product_sales: Sales by Creator, group by product

alter table public.foodics_import_batches
  add column if not exists import_type text not null default 'product_sales';

comment on column public.foodics_import_batches.import_type is
  'product_sales | waiter_product_sales — legacy rows default to product_sales';

create index if not exists idx_foodics_batches_import_type
  on public.foodics_import_batches (import_type, uploaded_at desc);

alter table public.foodics_sales_items
  add column if not exists product_sku text;

comment on column public.foodics_sales_items.product_sku is
  'Foodics Product SKU when imported from waiter/creator report';
