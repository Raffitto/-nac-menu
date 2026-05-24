-- Branch-scoped menu CMS — run in Supabase SQL editor.
-- Existing rows default to khobar; new branches start with isolated catalogs.

alter table categories add column if not exists branch_id text not null default 'khobar';
alter table sections add column if not exists branch_id text not null default 'khobar';
alter table menu_items add column if not exists branch_id text not null default 'khobar';

create index if not exists idx_categories_branch on categories (branch_id);
create index if not exists idx_sections_branch on sections (branch_id);
create index if not exists idx_menu_items_branch on menu_items (branch_id);

comment on column categories.branch_id is 'Canonical branch: khobar | riyadh | jeddah';
comment on column sections.branch_id is 'Canonical branch: khobar | riyadh | jeddah';
comment on column menu_items.branch_id is 'Canonical branch: khobar | riyadh | jeddah';

-- Per-branch menu engineering settings (availability windows, display prefs)
create table if not exists menu_branch_settings (
  branch_id text primary key check (branch_id in ('khobar', 'riyadh', 'jeddah')),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table menu_branch_settings enable row level security;

create policy "menu_branch_settings_read_authenticated"
  on menu_branch_settings for select to authenticated using (true);

create policy "menu_branch_settings_write_authenticated"
  on menu_branch_settings for all to authenticated using (true) with check (true);
