-- Drive ingest scheduler.
-- pg_net records the HTTP result only after the submitting transaction commits.
-- Waiting for that result inside invoke_nac_scheduled_drive_ingest() can never
-- observe it, and a cron success must not be treated as publication.
-- This submits the request, commits, and lets a later reconcile pass record
-- the HTTP result. It does not download files or insert Cash Up rows.

create table if not exists public.ask_nac_drive_scheduler_submissions (
  id uuid primary key default gen_random_uuid(),
  request_id bigint not null unique,
  attempt integer not null default 1 check (attempt between 1 and 3),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'failed')),
  http_status integer,
  detail text,
  created_at timestamptz not null default now(),
  reconciled_at timestamptz
);

alter table public.ask_nac_drive_scheduler_submissions enable row level security;
revoke all on table public.ask_nac_drive_scheduler_submissions from public;
revoke all on table public.ask_nac_drive_scheduler_submissions from anon;
revoke all on table public.ask_nac_drive_scheduler_submissions from authenticated;

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
    raise exception 'invoke_nac_scheduled_drive_ingest: vault secret drive_scheduled_ingest_secret missing';
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

  if v_request_id is null then
    raise exception 'invoke_nac_scheduled_drive_ingest: pg_net did not accept the request';
  end if;

  insert into public.ask_nac_drive_scheduler_submissions (request_id, attempt, status)
  values (v_request_id, 1, 'submitted');
end;
$func$;

comment on function public.invoke_nac_scheduled_drive_ingest() is
  'Submits vault-drive-sync scheduled_ingest and returns after commit. Cron success means the request was accepted by pg_net, not that Cash Up or Logbook rows were published.';

create or replace function public.reconcile_nac_drive_scheduler_submissions()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $func$
declare
  v_row public.ask_nac_drive_scheduler_submissions%rowtype;
  v_status int;
  v_body jsonb;
  v_error text;
  v_timed_out boolean;
  v_failed boolean;
  v_detail text;
  v_secret text;
  v_request_id bigint;
  v_body_text constant jsonb := jsonb_build_object(
    'action', 'scheduled_ingest',
    'maxFolders', 2,
    'maxFilesPerRun', 25,
    'reportTypes', jsonb_build_array('cash_up', 'daily_logbook')
  );
  v_url constant text := 'https://zeyhvjuraqnlbdycgrme.supabase.co/functions/v1/vault-drive-sync';
begin
  for v_row in
    select *
    from public.ask_nac_drive_scheduler_submissions
    where status = 'submitted'
    order by created_at
    limit 20
  loop
    select status_code, content::jsonb, error_msg, timed_out
      into v_status, v_body, v_error, v_timed_out
    from net._http_response
    where id = v_row.request_id;

    if v_status is null and coalesce(v_error, '') = '' and not coalesce(v_timed_out, false) then
      if v_row.created_at < now() - interval '15 minutes' then
        update public.ask_nac_drive_scheduler_submissions
        set status = 'failed',
            detail = 'no pg_net response after 15 minutes',
            reconciled_at = now()
        where id = v_row.id;
      end if;
      continue;
    end if;

    v_detail := left(coalesce(v_body->>'reason', v_body->'folderResults'->0->>'reason', v_error, ''), 240);
    v_failed := coalesce(v_timed_out, false)
      or v_status is null
      or v_status >= 400
      or coalesce(v_body->>'ok', 'false') <> 'true';

    update public.ask_nac_drive_scheduler_submissions
    set status = case when v_failed then 'failed' else 'accepted' end,
        http_status = v_status,
        detail = v_detail,
        reconciled_at = now()
    where id = v_row.id;

    if v_failed
       and v_row.attempt < 3
       and v_detail !~* 'invalid_grant|revoked|reconnect' then
      select decrypted_secret
        into v_secret
      from vault.decrypted_secrets
      where name = 'drive_scheduled_ingest_secret'
      order by created_at desc
      limit 1;

      if coalesce(v_secret, '') <> '' and v_row.created_at < now() - (v_row.attempt * interval '10 minutes') then
        select net.http_post(
          url := v_url,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_secret
          ),
          body := v_body_text,
          timeout_milliseconds := 55000
        )
        into v_request_id;

        if v_request_id is not null then
          insert into public.ask_nac_drive_scheduler_submissions (request_id, attempt, status)
          values (v_request_id, v_row.attempt + 1, 'submitted');
        end if;
      end if;
    end if;
  end loop;
end;
$func$;

comment on function public.reconcile_nac_drive_scheduler_submissions() is
  'Records pg_net results for Drive ingest submissions. Does not publish facts. Retries at most twice, with 10-minute backoff, and never retries an invalid_grant.';

revoke all on function public.invoke_nac_scheduled_drive_ingest() from public;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from authenticated;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from anon;
grant execute on function public.invoke_nac_scheduled_drive_ingest() to postgres;

revoke all on function public.reconcile_nac_drive_scheduler_submissions() from public;
revoke all on function public.reconcile_nac_drive_scheduler_submissions() from authenticated;
revoke all on function public.reconcile_nac_drive_scheduler_submissions() from anon;
grant execute on function public.reconcile_nac_drive_scheduler_submissions() to postgres;

do $cron$
declare
  r record;
  v_job_id bigint;
begin
  for r in
    select jobid from cron.job where jobname = 'nac_reconcile_drive_scheduler'
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  select cron.schedule(
    'nac_reconcile_drive_scheduler',
    '*/10 * * * *',
    $job$select public.reconcile_nac_drive_scheduler_submissions();$job$
  )
  into v_job_id;
end;
$cron$;
