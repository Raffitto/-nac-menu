-- Drive ingest scheduler health.
-- pg_net returns before the Edge Function finishes. The previous invoker
-- treated that submit as success, so cron.job_run_details stayed "succeeded"
-- while Google rejected the refresh token. This waits for the response and
-- raises when the function reports failure. It does not read or print secrets.

create or replace function public.invoke_nac_scheduled_drive_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $func$
declare
  v_secret text;
  v_request_id bigint;
  v_status int;
  v_body jsonb;
  v_error text;
  v_timed_out boolean;
  v_attempt int;
  v_body_text constant jsonb := jsonb_build_object(
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
    body := v_body_text,
    timeout_milliseconds := 55000
  )
  into v_request_id;

  for v_attempt in 1..25 loop
    select status_code, content::jsonb, error_msg, timed_out
      into v_status, v_body, v_error, v_timed_out
    from net._http_response
    where id = v_request_id;

    exit when v_status is not null or coalesce(v_error, '') <> '' or coalesce(v_timed_out, false);
    perform pg_sleep(2);
  end loop;

  if v_status is null then
    raise exception 'invoke_nac_scheduled_drive_ingest: no pg_net response for request %', v_request_id;
  end if;

  if coalesce(v_timed_out, false)
     or v_status >= 400
     or coalesce(v_body->>'ok', 'false') <> 'true' then
    raise exception
      'invoke_nac_scheduled_drive_ingest failed status=% timed_out=% detail=%',
      v_status,
      coalesce(v_timed_out, false),
      left(coalesce(v_body->>'reason', v_body->'folderResults'->0->>'reason', v_error, ''), 240);
  end if;
end;
$func$;

comment on function public.invoke_nac_scheduled_drive_ingest() is
  'POST vault-drive-sync scheduled_ingest at 03:00 Asia/Riyadh and fail the cron run when the function reports failure.';

revoke all on function public.invoke_nac_scheduled_drive_ingest() from public;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from authenticated;
revoke all on function public.invoke_nac_scheduled_drive_ingest() from anon;
grant execute on function public.invoke_nac_scheduled_drive_ingest() to postgres;
