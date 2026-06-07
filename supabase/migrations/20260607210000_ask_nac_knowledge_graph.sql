-- Ask NAC operational knowledge graph — document relationships

create table if not exists public.ask_nac_document_links (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  target_file_id uuid not null references public.ask_nac_files (id) on delete cascade,
  link_type text not null check (
    link_type in (
      'same_branch_period',
      'operational_chain',
      'shared_issue',
      'sales_to_reception',
      'reception_to_logbook',
      'logbook_to_audit'
    )
  ),
  link_reason text,
  confidence numeric,
  branch_id text check (branch_id is null or branch_id in ('khobar', 'riyadh', 'jeddah')),
  period_start date,
  period_end date,
  shared_terms text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_file_id, target_file_id, link_type)
);

create index if not exists idx_ask_nac_document_links_source on public.ask_nac_document_links (source_file_id);
create index if not exists idx_ask_nac_document_links_target on public.ask_nac_document_links (target_file_id);
create index if not exists idx_ask_nac_document_links_branch_period on public.ask_nac_document_links (branch_id, period_start, period_end);

alter table public.ask_nac_document_links enable row level security;

drop policy if exists ask_nac_document_links_select on public.ask_nac_document_links;
create policy ask_nac_document_links_select on public.ask_nac_document_links
  for select to authenticated
  using (
    public.ask_nac_vault_can_read_file(source_file_id)
    and public.ask_nac_vault_can_read_file(target_file_id)
  );

drop policy if exists ask_nac_document_links_insert on public.ask_nac_document_links;
create policy ask_nac_document_links_insert on public.ask_nac_document_links
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_read_file(source_file_id)
    and public.ask_nac_vault_can_read_file(target_file_id)
  );

grant select, insert on public.ask_nac_document_links to authenticated;
