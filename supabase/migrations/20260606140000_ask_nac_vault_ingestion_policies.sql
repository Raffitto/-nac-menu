-- Ask NAC Data Vault — ingestion write policies (prototype parsers, client-side worker)
-- Safe to re-run.

-- Ingestion jobs: allow uploader to update status/stats
drop policy if exists ask_nac_ingestion_update on public.ask_nac_ingestion_jobs;
create policy ask_nac_ingestion_update on public.ask_nac_ingestion_jobs
  for update to authenticated
  using (public.ask_nac_vault_can_read_file(file_id) and public.ask_nac_vault_can_upload())
  with check (public.ask_nac_vault_can_read_file(file_id));

-- Coverage: update fact counts after parse
drop policy if exists ask_nac_coverage_update on public.ask_nac_data_coverage;
create policy ask_nac_coverage_update on public.ask_nac_data_coverage
  for update to authenticated
  using (
    source_file_id is not null
    and public.ask_nac_vault_can_read_file(source_file_id)
    and public.ask_nac_vault_can_upload()
  )
  with check (
    source_file_id is not null
    and public.ask_nac_vault_can_read_file(source_file_id)
  );

-- Structured facts: insert parsed rows scoped to readable file
drop policy if exists ask_nac_facts_insert on public.ask_nac_structured_facts;
create policy ask_nac_facts_insert on public.ask_nac_structured_facts
  for insert to authenticated
  with check (
    public.ask_nac_vault_can_upload()
    and file_id is not null
    and public.ask_nac_vault_can_read_file(file_id)
    and public.ask_nac_vault_can_read_scope(
      branch_id,
      brand_wide,
      department,
      sensitivity_level
    )
  );

grant update on public.ask_nac_ingestion_jobs to authenticated;
grant update on public.ask_nac_data_coverage to authenticated;
grant insert on public.ask_nac_structured_facts to authenticated;

-- Parser version on templates (prototype)
update public.ask_nac_report_type_templates
set parser_version = 'vault-prototype-v1'
where code in ('cash_up', 'reception_daily_report', 'daily_logbook');
