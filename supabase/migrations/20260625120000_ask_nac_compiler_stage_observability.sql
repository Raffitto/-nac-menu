-- Compiler job stage observability (Phase 1B) — backward compatible, nullable fields.

alter table public.ask_nac_ingestion_jobs
  add column if not exists compiler_profile text,
  add column if not exists compiler_version text,
  add column if not exists compiler_stage text,
  add column if not exists compiler_stages jsonb not null default '[]'::jsonb,
  add column if not exists compilation_manifest jsonb not null default '{}'::jsonb,
  add column if not exists quarantine_reason text;

create index if not exists idx_ask_nac_ingestion_jobs_compiler_stage
  on public.ask_nac_ingestion_jobs (compiler_stage)
  where compiler_stage is not null;

create index if not exists idx_ask_nac_ingestion_jobs_compiler_profile
  on public.ask_nac_ingestion_jobs (compiler_profile)
  where compiler_profile is not null;

comment on column public.ask_nac_ingestion_jobs.compiler_stage is
  'Current compiler observability stage (understand, classify, legacy_parse, etc.).';
comment on column public.ask_nac_ingestion_jobs.compiler_stages is
  'Append-only stage timeline for compiler observability.';
comment on column public.ask_nac_ingestion_jobs.compilation_manifest is
  'Future compiler manifest; patchable metadata during observability phase.';
