-- Atomic structured-facts replacement for Drive ingestion (service-role RPC only).
-- Inserts new facts first, validates, then deletes superseded rows in one transaction.

create or replace function public.replace_ask_nac_file_structured_facts(
  p_file_id uuid,
  p_facts jsonb,
  p_period_start date default null,
  p_period_end date default null,
  p_min_inserted int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_ids uuid[];
  v_inserted bigint;
  v_deleted bigint;
  v_null_period bigint;
begin
  if p_file_id is null then
    raise exception 'file_id required';
  end if;

  if p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) = 0 then
    raise exception 'facts array required';
  end if;

  with inserted as (
    insert into public.ask_nac_structured_facts (
      file_id,
      file_version_id,
      branch_id,
      brand_wide,
      department,
      report_type,
      sensitivity_level,
      metric_key,
      metric_value,
      metric_unit,
      dimensions,
      period_start,
      period_end,
      grain,
      source_row_ref,
      confidence,
      created_by
    )
    select
      p_file_id,
      nullif(r.file_version_id, '')::uuid,
      r.branch_id,
      coalesce(r.brand_wide, false),
      r.department,
      r.report_type,
      r.sensitivity_level,
      r.metric_key,
      r.metric_value,
      r.metric_unit,
      coalesce(r.dimensions, '{}'::jsonb),
      r.period_start::date,
      r.period_end::date,
      coalesce(nullif(r.grain, ''), 'daily'),
      r.source_row_ref,
      r.confidence,
      r.created_by
    from jsonb_to_recordset(p_facts) as r(
      file_version_id text,
      branch_id text,
      brand_wide boolean,
      department text,
      report_type text,
      sensitivity_level text,
      metric_key text,
      metric_value numeric,
      metric_unit text,
      dimensions jsonb,
      period_start text,
      period_end text,
      grain text,
      source_row_ref text,
      confidence numeric,
      created_by text
    )
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]), count(*)
  into v_new_ids, v_inserted
  from inserted;

  if v_inserted < p_min_inserted then
    raise exception 'inserted fact count % below minimum %', v_inserted, p_min_inserted;
  end if;

  select count(*)
  into v_null_period
  from public.ask_nac_structured_facts
  where id = any(v_new_ids)
    and period_end is null;

  if v_null_period > 0 then
    raise exception 'inserted facts include % rows with null period_end', v_null_period;
  end if;

  delete from public.ask_nac_structured_facts
  where file_id = p_file_id
    and not (id = any(v_new_ids));

  get diagnostics v_deleted = row_count;

  if p_period_start is not null and p_period_end is not null then
    update public.ask_nac_files
    set period_start = p_period_start,
        period_end = p_period_end,
        updated_at = now()
    where id = p_file_id;

    update public.ask_nac_data_coverage
    set period_start = p_period_start,
        period_end = p_period_end,
        updated_at = now()
    where source_file_id = p_file_id;
  end if;

  return jsonb_build_object(
    'file_id', p_file_id,
    'inserted', v_inserted,
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.replace_ask_nac_file_structured_facts(uuid, jsonb, date, date, int) from public;
grant execute on function public.replace_ask_nac_file_structured_facts(uuid, jsonb, date, date, int) to service_role;

comment on function public.replace_ask_nac_file_structured_facts(uuid, jsonb, date, date, int) is
  'Atomically replace structured facts for a vault file: insert new rows, validate, delete superseded rows in one transaction.';
