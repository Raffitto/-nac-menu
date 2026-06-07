-- Add CCM reconciliation report type template (parser coverage upgrade)
insert into public.ask_nac_report_type_templates (code, label, default_department, default_data_layer, default_sensitivity, parser_version) values
  ('ccm_reconciliation', 'CCM Reconciliation', 'admin', 'operational', 'finance', 'vault-prototype-v2')
on conflict (code) do update set
  label = excluded.label,
  default_department = excluded.default_department,
  default_data_layer = excluded.default_data_layer,
  default_sensitivity = excluded.default_sensitivity,
  parser_version = excluded.parser_version;

update public.ask_nac_report_type_templates
set parser_version = 'vault-prototype-v2'
where code in ('cash_up', 'reception_daily_report', 'daily_logbook', 'ccm_reconciliation');
