-- =============================================================================
-- NAC — Cashup + Logbook daily Drive ingest at 03:00 Asia/Riyadh
-- Safe to re-run.
--
-- Schedule: 03:00 Asia/Riyadh year-round = 00:00 UTC → cron "0 0 * * *"
-- Scope: maxFolders=2 with cash_up then daily_logbook priority (edge filter).
-- Body also raises maxFilesPerRun to 25 for safer catch-up within the Edge budget.
--
-- Also reconciles stale running/queued Drive sync runs (audit preserved as partial).
-- Marks invalid Drive connections as reconnect_required when last_error indicates
-- token refresh failure (does not wipe tokens).
-- =============================================================================

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
  v_body constant jsonb := jsonb_build_object(
    'action', 'scheduled_ingest',
    'maxFolders', 2,
    'maxFilesPerRun', 25,
    'reportTypes', jsonb_build_array('cash_up', 'daily_logbook')
  );
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
  'POST vault-drive-sync scheduled_ingest for Cashup+Logbook at 03:00 Asia/Riyadh (00:00 UTC). Requires vault secret drive_scheduled_ingest_secret.';

revoke all on function public.invoke_nac_scheduled_drive_ingest() from public;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from authenticated;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from anon;
grant execute on function public.invoke_nac_scheduled_drive_ingest() to postgres;

-- Allow explicit reconnect_required health state on Drive connections.
alter table public.ask_nac_drive_connections
  drop constraint if exists ask_nac_drive_connections_status_check;

alter table public.ask_nac_drive_connections
  add constraint ask_nac_drive_connections_status_check
  check (status in ('active', 'revoked', 'error', 'reconnect_required'));

-- Reconcile stale active runs (preserve rows; mark partial).
update public.ask_nac_drive_sync_runs
set
  status = 'partial',
  runtime_stage = 'stale_run_reconciled',
  finished_at = coalesce(finished_at, now()),
  completed_at = coalesce(completed_at, now()),
  updated_at = now(),
  current_file = null,
  stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object(
    'staleRunReconciled', true,
    'scheduledStopReason', 'scheduled_worker_aborted',
    'runtimeStage', 'stale_run_reconciled'
  )
where status in ('running', 'queued')
  and created_at < now() - interval '15 minutes';

-- Surface reconnect requirement on known broken Drive connections.
update public.ask_nac_drive_connections
set
  status = 'reconnect_required',
  last_error = coalesce(
    nullif(last_error, ''),
    'Google Drive authorization expired. Reconnect required.'
  ),
  updated_at = now()
where status = 'active'
  and (
    token_expires_at is not null
    and token_expires_at < now() - interval '7 days'
  )
  and exists (
    select 1
    from public.ask_nac_drive_sync_runs r
    where r.runtime_stage = 'token_refresh_failed'
      and r.created_at > now() - interval '30 days'
  );

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
    '0 0 * * *',
    $job$select public.invoke_nac_scheduled_drive_ingest();$job$
  )
  into v_job_id;

  raise notice 'Scheduled nac_scheduled_drive_ingest at 00:00 UTC / 03:00 Asia/Riyadh (job_id=%)', v_job_id;
end;
$cron$;
