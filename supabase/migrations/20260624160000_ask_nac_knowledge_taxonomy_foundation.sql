-- NAC Master Knowledge Taxonomy — Phase 1 foundation columns + topic seeds.

alter table public.ask_nac_files
  add column if not exists knowledge_domain text
    check (knowledge_domain is null or knowledge_domain in (
      'executive', 'operations', 'commercial', 'culinary', 'procurement',
      'food_safety', 'hr', 'asset', 'brand', 'competitive', 'finance', 'unknown'
    )),
  add column if not exists knowledge_subdomain text,
  add column if not exists artifact_type text
    check (artifact_type is null or artifact_type in (
      'policy_manual', 'procedure', 'checklist', 'log', 'report', 'evaluation',
      'invoice', 'recipe', 'specification', 'training_material', 'dashboard',
      'memory', 'unknown'
    )),
  add column if not exists authority_level text
    check (authority_level is null or authority_level in (
      'corporate_manual', 'signed_policy', 'job_description', 'branch_sop',
      'uploaded_report', 'manager_memory', 'operator_memory', 'inferred'
    ));

alter table public.ask_nac_structured_facts
  add column if not exists knowledge_domain text
    check (knowledge_domain is null or knowledge_domain in (
      'executive', 'operations', 'commercial', 'culinary', 'procurement',
      'food_safety', 'hr', 'asset', 'brand', 'competitive', 'finance', 'unknown'
    ));

alter table public.ask_nac_data_coverage
  add column if not exists knowledge_domain text
    check (knowledge_domain is null or knowledge_domain in (
      'executive', 'operations', 'commercial', 'culinary', 'procurement',
      'food_safety', 'hr', 'asset', 'brand', 'competitive', 'finance', 'unknown'
    ));

create index if not exists idx_ask_nac_files_knowledge_domain
  on public.ask_nac_files (knowledge_domain, report_type)
  where knowledge_domain is not null;

-- Backfill from existing report_type (safe defaults).
update public.ask_nac_files
set
  knowledge_domain = case report_type
    when 'cash_up' then 'operations'
    when 'reception_daily_report' then 'operations'
    when 'daily_logbook' then 'operations'
    when 'daily_briefing' then 'operations'
    when 'ccm_reconciliation' then 'operations'
    when 'breakage_report' then 'operations'
    when 'discount_void_comp' then 'operations'
    when 'guest_feedback' then 'commercial'
    when 'weekly_sales_overview' then 'executive'
    when 'weekly_dashboard' then 'executive'
    when 'foodics_export' then 'commercial'
    when 'pnl' then 'finance'
    when 'budget' then 'finance'
    when 'forecast' then 'finance'
    when 'gm_report' then 'executive'
    when 'audit_report' then 'food_safety'
    when 'brand_brain_sop' then 'brand'
    else coalesce(knowledge_domain, 'unknown')
  end,
  authority_level = coalesce(authority_level, 'uploaded_report'),
  artifact_type = coalesce(artifact_type, case
    when report_type in ('weekly_dashboard', 'weekly_sales_overview') then 'dashboard'
    when report_type = 'brand_brain_sop' then 'procedure'
    else 'report'
  end)
where knowledge_domain is null or authority_level is null or artifact_type is null;

update public.ask_nac_structured_facts f
set knowledge_domain = case f.report_type
  when 'cash_up' then 'operations'
  when 'reception_daily_report' then 'operations'
  when 'daily_logbook' then 'operations'
  when 'daily_briefing' then 'operations'
  when 'ccm_reconciliation' then 'operations'
  when 'breakage_report' then 'operations'
  when 'discount_void_comp' then 'operations'
  when 'guest_feedback' then 'commercial'
  when 'weekly_sales_overview' then 'executive'
  when 'weekly_dashboard' then 'executive'
  when 'pnl' then 'finance'
  when 'budget' then 'finance'
  when 'forecast' then 'finance'
  when 'gm_report' then 'executive'
  when 'audit_report' then 'food_safety'
  when 'brand_brain_sop' then 'brand'
  else 'unknown'
end
where f.knowledge_domain is null;

update public.ask_nac_data_coverage c
set knowledge_domain = case c.report_type
  when 'cash_up' then 'operations'
  when 'reception_daily_report' then 'operations'
  when 'daily_logbook' then 'operations'
  when 'daily_briefing' then 'operations'
  when 'ccm_reconciliation' then 'operations'
  when 'breakage_report' then 'operations'
  when 'discount_void_comp' then 'operations'
  when 'guest_feedback' then 'commercial'
  when 'weekly_sales_overview' then 'executive'
  when 'weekly_dashboard' then 'executive'
  when 'pnl' then 'finance'
  when 'budget' then 'finance'
  when 'forecast' then 'finance'
  when 'gm_report' then 'executive'
  when 'audit_report' then 'food_safety'
  when 'brand_brain_sop' then 'brand'
  else 'unknown'
end
where c.knowledge_domain is null;

-- Brand Brain topic expansion (taxonomy-aligned).
insert into public.ask_nac_brand_brain_topics (code, label, parent_code, default_department, keywords) values
  ('brand.values', 'Brand Values', 'brand', 'brand', array['values','culture','mission']),
  ('brand.training', 'Training Standards', 'brand', 'hr', array['training','induction','onboarding']),
  ('food_safety', 'Food Safety', null, 'kitchen', array['food safety','haccp','hygiene']),
  ('food_safety.haccp', 'HACCP', 'food_safety', 'kitchen', array['haccp','hazard','ccp']),
  ('food_safety.receiving', 'Receiving', 'food_safety', 'purchasing', array['receiving','delivery','supplier vehicle']),
  ('food_safety.storage', 'Storage & FIFO', 'food_safety', 'kitchen', array['storage','fifo','holding']),
  ('food_safety.temperature', 'Temperature Monitoring', 'food_safety', 'kitchen', array['temperature','thermometer','cooling','hot holding']),
  ('food_safety.cleaning', 'Cleaning & Sanitation', 'food_safety', 'kitchen', array['cleaning','sanitation','hood','equipment']),
  ('food_safety.personal_hygiene', 'Personal Hygiene', 'food_safety', 'kitchen', array['hygiene','handwash','grooming']),
  ('food_safety.allergens', 'Allergens', 'food_safety', 'kitchen', array['allergen','allergy','intolerance']),
  ('food_safety.traceability', 'Traceability', 'food_safety', 'kitchen', array['traceability','batch','lot']),
  ('food_safety.recall', 'Recall Procedures', 'food_safety', 'kitchen', array['recall','withdrawal']),
  ('procurement', 'Procurement', null, 'purchasing', array['procurement','supplier','purchasing']),
  ('procurement.supplier_evaluation', 'Supplier Evaluation', 'procurement', 'purchasing', array['supplier evaluation','vendor assessment']),
  ('asset', 'Assets & Equipment', null, 'operations', array['asset','equipment','maintenance']),
  ('asset.maintenance', 'Preventive Maintenance', 'asset', 'operations', array['maintenance','pm','preventive']),
  ('culinary', 'Culinary Standards', null, 'kitchen', array['culinary','recipe','kitchen']),
  ('culinary.recipe_standards', 'Recipe Standards', 'culinary', 'kitchen', array['recipe','yield','specification']),
  ('waste', 'Waste Management', null, 'cost_control', array['waste','spoilage','shrink']),
  ('waste.spoilage', 'Spoilage & Waste', 'waste', 'cost_control', array['spoilage','waste','breakage']),
  ('waste.recycling', 'Recycling', 'waste', 'operations', array['recycling','disposal'])
on conflict (code) do update set
  label = excluded.label,
  parent_code = excluded.parent_code,
  default_department = excluded.default_department,
  keywords = excluded.keywords;

comment on column public.ask_nac_files.knowledge_domain is
  'Master knowledge domain taxonomy (executive, operations, food_safety, etc.).';
comment on column public.ask_nac_files.knowledge_subdomain is
  'Optional subdomain code (e.g. food_safety.haccp, procurement.supplier).';
comment on column public.ask_nac_files.artifact_type is
  'Document artifact class (policy_manual, checklist, log, report, etc.).';
comment on column public.ask_nac_files.authority_level is
  'Source authority hierarchy for conflict resolution.';
