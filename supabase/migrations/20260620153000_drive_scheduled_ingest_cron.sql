-- =============================================================================
-- NAC — Scheduled Google Drive auto-ingest (pg_cron → vault-drive-sync)
-- Safe to re-run.
--
-- Schedule: daily 04:30 Asia/Riyadh (UTC+3) = 01:30 UTC → cron "30 1 * * *"
--
-- Conservative request body (do not remove limits):
--   {"action":"scheduled_ingest","maxFolders":2,"maxFilesPerRun":10}
--
-- Prerequisites (operators — NOT in git):
--   1) Edge secret DRIVE_SCHEDULED_INGEST_SECRET on vault-drive-sync
--   2) vault-drive-sync deployed with --no-verify-jwt
--   3) Matching Vault secret for pg_cron bearer auth (one-time, SQL Editor):
--
--      select vault.create_secret(
--        '<same value as DRIVE_SCHEDULED_INGEST_SECRET>',
--        'drive_scheduled_ingest_secret',
--        'Bearer token for pg_cron → vault-drive-sync scheduled_ingest'
--      );
--
-- Never put SUPABASE_SERVICE_ROLE_KEY or DRIVE_SCHEDULED_INGEST_SECRET in git.
-- =============================================================================

-- pg_cron already enabled for rollup refresh; pg_net required for HTTP invoke.
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_nac_scheduled_drive_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $func$
declare
  v_secret text;
  v_request_id bigint;
  v_body constant jsonb := '{"action":"scheduled_ingest","maxFolders":2,"maxFilesPerRun":10}'::jsonb;
  v_url constant text := 'https://zeyhvjuraqnlbdycgrme.supabase.co/functions/v1/vault-drive-sync';
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'drive_scheduled_ingest_secret'
  order by created_at desc
  limit 1;

  if coalesce(v_secret, '') = '' then
    raise warning 'invoke_nac_scheduled_drive_ingest: vault secret drive_scheduled_ingest_secret missing; skipping.';
    return;
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := v_body,
    timeout_milliseconds := 55000
  )
  into v_request_id;

  raise notice 'invoke_nac_scheduled_drive_ingest: pg_net request_id=%', v_request_id;
end;
$func$;

comment on function public.invoke_nac_scheduled_drive_ingest() is
  'POST vault-drive-sync scheduled_ingest with conservative limits (maxFolders=2, maxFilesPerRun=10). Requires vault secret drive_scheduled_ingest_secret.';

revoke all on function public.invoke_nac_scheduled_drive_ingest() from public;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from authenticated;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from anon;
grant execute on function public.invoke_nac_scheduled_drive_ingest() to postgres;

do $cron$
declare
  r record;
  v_job_id bigint;
begin
  for r in
    select jobid from cron.job where jobname = 'nac_scheduled_drive_ingest'
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  select cron.schedule(
    'nac_scheduled_drive_ingest',
    '30 1 * * *',
    $job$select public.invoke_nac_scheduled_drive_ingest();$job$
  )
  into v_job_id;

  raise notice 'Scheduled nac_scheduled_drive_ingest (job_id=%)', v_job_id;
end;
$cron$;

-- Verify (read-only):
-- select jobid, jobname, schedule, command, active
-- from cron.job
-- where jobname = 'nac_scheduled_drive_ingest';
