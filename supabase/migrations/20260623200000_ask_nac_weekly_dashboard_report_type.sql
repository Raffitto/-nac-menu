-- Executive Reports / Weekly Dashboards — dedicated vault report type for Drive ingest + Ask NAC search.

insert into public.ask_nac_report_type_templates (code, label, default_department, default_data_layer, default_sensitivity, parser_version, active)
values
  ('weekly_dashboard', 'Weekly Management Dashboard', 'operations', 'operational', 'management', 'vault-prototype-v3', true)
on conflict (code) do update set
  label = excluded.label,
  default_department = excluded.default_department,
  default_sensitivity = excluded.default_sensitivity,
  parser_version = excluded.parser_version,
  active = excluded.active;

comment on table public.ask_nac_report_type_templates is
  'Registry of vault report types including weekly_dashboard for Executive Reports / Weekly Dashboards Drive folders.';
