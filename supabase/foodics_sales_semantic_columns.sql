-- Semantic / modifier tracking on imported Foodics line items
-- Run after foodics_import_schema.sql

alter table public.foodics_sales_items
  add column if not exists semantic_class text,
  add column if not exists analytics_category text,
  add column if not exists is_modifier boolean not null default false;

create index if not exists idx_foodics_sales_semantic on public.foodics_sales_items (semantic_class);
create index if not exists idx_foodics_sales_analytics_cat on public.foodics_sales_items (analytics_category);
create index if not exists idx_foodics_sales_is_modifier on public.foodics_sales_items (is_modifier)
  where is_modifier = true;
