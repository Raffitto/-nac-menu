-- Monthly logbook executive summary hot path:
--   branch_id = ?
--   report_type = 'daily_logbook'
--   metric_key IN (summary metric keys)
--   period_start <= :end_date AND period_end >= :start_date
--   ORDER BY period_start
-- Partial index mirrors cash_up range pattern (idx_ask_nac_facts_cash_up_range).

create index if not exists idx_ask_nac_facts_logbook_month
  on public.ask_nac_structured_facts (branch_id, period_start, metric_key)
  include (period_end, file_id, metric_value, dimensions)
  where report_type = 'daily_logbook' and archived_at is null;
