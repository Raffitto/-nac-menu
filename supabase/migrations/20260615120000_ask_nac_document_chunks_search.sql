-- CK-2: Document chunk schema for keyword search (no embeddings/OCR).
-- Idempotent upgrade from foundation ask_nac_document_chunks.

-- ── File registry search tracking ───────────────────────────────────────────

alter table public.ask_nac_files
  add column if not exists chunk_count int not null default 0;

alter table public.ask_nac_files
  add column if not exists search_status text not null default 'not_searchable';

alter table public.ask_nac_files
  add column if not exists searchable_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ask_nac_files_search_status_check'
      and conrelid = 'public.ask_nac_files'::regclass
  ) then
    alter table public.ask_nac_files
      add constraint ask_nac_files_search_status_check
      check (search_status in ('not_searchable', 'indexing', 'searchable', 'failed'));
  end if;
exception
  when others then
    raise notice 'ask_nac_files search_status check skipped: %', sqlerrm;
end $$;

create index if not exists idx_ask_nac_files_search_status
  on public.ask_nac_files (search_status);

-- ── Column renames (foundation → CK-2) ──────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ask_nac_document_chunks' and column_name = 'content'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ask_nac_document_chunks' and column_name = 'chunk_text'
  ) then
    alter table public.ask_nac_document_chunks rename column content to chunk_text;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ask_nac_document_chunks' and column_name = 'source_page'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ask_nac_document_chunks' and column_name = 'page_no'
  ) then
    alter table public.ask_nac_document_chunks rename column source_page to page_no;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ask_nac_document_chunks' and column_name = 'heading_path'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ask_nac_document_chunks' and column_name = 'section_label'
  ) then
    alter table public.ask_nac_document_chunks rename column heading_path to section_label;
  end if;
end $$;

-- ── New chunk columns ───────────────────────────────────────────────────────

alter table public.ask_nac_document_chunks
  add column if not exists file_version_id uuid;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ask_nac_file_versions'
  ) and not exists (
    select 1 from pg_constraint
    where conname = 'ask_nac_document_chunks_file_version_id_fkey'
  ) then
    alter table public.ask_nac_document_chunks
      add constraint ask_nac_document_chunks_file_version_id_fkey
      foreign key (file_version_id) references public.ask_nac_file_versions (id) on delete set null;
  end if;
exception
  when others then
    raise notice 'ask_nac_document_chunks file_version_id fk skipped: %', sqlerrm;
end $$;

alter table public.ask_nac_document_chunks
  add column if not exists report_type text;

alter table public.ask_nac_document_chunks
  add column if not exists data_layer text;

alter table public.ask_nac_document_chunks
  add column if not exists period_start date;

alter table public.ask_nac_document_chunks
  add column if not exists period_end date;

alter table public.ask_nac_document_chunks
  add column if not exists content_hash text;

-- Ensure chunk_text exists (fresh installs use foundation content column renamed above)
alter table public.ask_nac_document_chunks
  add column if not exists chunk_text text;

-- Backfill content_hash for legacy rows (pgcrypto optional; md5 fallback built-in)
do $$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception
    when others then
      raise notice 'pgcrypto extension skipped: %', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pgcrypto') then
    update public.ask_nac_document_chunks
    set content_hash = encode(extensions.digest(coalesce(chunk_text, ''), 'sha256'), 'hex')
    where content_hash is null and chunk_text is not null;
  else
    update public.ask_nac_document_chunks
    set content_hash = 'legacy-md5:' || md5(coalesce(chunk_text, ''))
    where content_hash is null and chunk_text is not null;
  end if;

  update public.ask_nac_document_chunks
  set content_hash = 'legacy-id:' || id::text
  where content_hash is null;
exception
  when others then
    raise notice 'ask_nac_document_chunks content_hash backfill skipped: %', sqlerrm;
end $$;

-- ── Full-text search vector ─────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ask_nac_document_chunks'
      and column_name = 'search_vector'
  ) then
    alter table public.ask_nac_document_chunks
      add column search_vector tsvector
      generated always as (to_tsvector('english', coalesce(chunk_text, ''))) stored;
  end if;
exception
  when others then
    raise notice 'ask_nac_document_chunks search_vector skipped: %', sqlerrm;
end $$;

-- ── Constraints & indexes ───────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ask_nac_document_chunks'
      and column_name = 'chunk_text'
      and is_nullable = 'YES'
  ) then
    alter table public.ask_nac_document_chunks alter column chunk_text set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ask_nac_document_chunks'
      and column_name = 'content_hash'
      and is_nullable = 'YES'
  ) then
    alter table public.ask_nac_document_chunks alter column content_hash set not null;
  end if;
exception
  when others then
    raise notice 'ask_nac_document_chunks NOT NULL constraints skipped: %', sqlerrm;
end $$;

create unique index if not exists idx_ask_nac_chunks_file_content_hash
  on public.ask_nac_document_chunks (file_id, content_hash);

create index if not exists idx_ask_nac_chunks_search_vector
  on public.ask_nac_document_chunks using gin (search_vector);

create index if not exists idx_ask_nac_chunks_report_type
  on public.ask_nac_document_chunks (report_type);

create index if not exists idx_ask_nac_chunks_period_start
  on public.ask_nac_document_chunks (period_start);

create index if not exists idx_ask_nac_chunks_period_end
  on public.ask_nac_document_chunks (period_end);

-- ── RLS (file-scoped read; upload-scoped write) ─────────────────────────────

drop policy if exists ask_nac_chunks_select on public.ask_nac_document_chunks;
create policy ask_nac_chunks_select on public.ask_nac_document_chunks
  for select to authenticated
  using (public.ask_nac_vault_can_read_file(file_id));

drop policy if exists ask_nac_chunks_insert on public.ask_nac_document_chunks;
create policy ask_nac_chunks_insert on public.ask_nac_document_chunks
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and public.ask_nac_vault_can_read_file(file_id)
  );

drop policy if exists ask_nac_chunks_update on public.ask_nac_document_chunks;
create policy ask_nac_chunks_update on public.ask_nac_document_chunks
  for update to authenticated
  using (public.ask_nac_vault_can_read_file(file_id) and public.ask_nac_vault_can_upload())
  with check (public.ask_nac_vault_can_read_file(file_id));

drop policy if exists ask_nac_chunks_delete on public.ask_nac_document_chunks;
create policy ask_nac_chunks_delete on public.ask_nac_document_chunks
  for delete to authenticated
  using (public.ask_nac_vault_can_read_file(file_id) and public.ask_nac_vault_can_upload());

grant select, insert, update, delete on public.ask_nac_document_chunks to authenticated;
