-- Register the live parent of "2026 review tracking" for scheduled ingest.
-- Walks only this Staff folder and keeps name-filtered review-tracking files.

insert into public.ask_nac_drive_sync_folders (
  connection_id,
  drive_folder_id,
  folder_name,
  label,
  default_branch_id,
  default_department,
  branch_id,
  department,
  report_type,
  sensitivity,
  auto_ingest,
  is_discovery_root,
  schedule,
  enabled
)
select
  c.id,
  '1XOErzMOpxuqyYEjSxGYCbIrZBTDBpZZu',
  'Staff',
  'Staff',
  'khobar',
  'reception',
  'khobar',
  'reception',
  'google_review_tracking',
  'internal',
  true,
  false,
  'daily',
  true
from public.ask_nac_drive_connections c
where c.status in ('active', 'reconnect_required')
order by c.updated_at desc
limit 1
on conflict (connection_id, drive_folder_id) do update
set
  report_type = 'google_review_tracking',
  auto_ingest = true,
  is_discovery_root = false,
  schedule = 'daily',
  enabled = true,
  department = 'reception',
  default_department = 'reception';
