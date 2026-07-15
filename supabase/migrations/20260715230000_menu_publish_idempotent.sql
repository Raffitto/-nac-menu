-- Idempotent menu publish: prevent duplicate (branch_id, version) races and reuse in-flight rows.

create or replace function public.publish_menu_branch(
  p_branch text,
  p_change_summary jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := public.nac_normalize_branch_id(p_branch);
  v_snapshot jsonb;
  v_fingerprint text;
  v_existing public.menu_publications%rowtype;
  v_latest public.menu_publications%rowtype;
  v_inflight public.menu_publications%rowtype;
  v_row public.menu_publications%rowtype;
  v_version bigint;
  v_max_version bigint;
  v_email text := public.nac_auth_email();
begin
  if v_branch is null or not public.nac_menu_can_edit_branch(v_branch) then
    raise exception 'Menu publish access denied for branch %', coalesce(p_branch, '');
  end if;

  perform pg_advisory_xact_lock(hashtext('nac_menu_publish:' || v_branch));

  if p_idempotency_key is not null then
    select * into v_existing
    from public.menu_publications
    where branch_id = v_branch and idempotency_key = p_idempotency_key;
    if found then
      return to_jsonb(v_existing) || jsonb_build_object('idempotent', true);
    end if;
  end if;

  v_snapshot := public.nac_menu_branch_snapshot(v_branch);
  v_fingerprint := md5(v_snapshot::text);

  select * into v_latest
  from public.menu_publications
  where branch_id = v_branch and status = 'live'
  order by version desc
  limit 1;

  if found and v_latest.snapshot_fingerprint = v_fingerprint then
    return to_jsonb(v_latest)
      || jsonb_build_object('idempotent', true, 'already_live', true);
  end if;

  select * into v_inflight
  from public.menu_publications
  where branch_id = v_branch
    and snapshot_fingerprint = v_fingerprint
    and status = 'publishing'
  order by version desc
  limit 1;

  if found then
    if p_idempotency_key is not null
      and v_inflight.idempotency_key is distinct from p_idempotency_key then
      update public.menu_publications
      set idempotency_key = p_idempotency_key
      where id = v_inflight.id;
      select * into v_inflight from public.menu_publications where id = v_inflight.id;
    end if;
    return to_jsonb(v_inflight) || jsonb_build_object('reused', true);
  end if;

  select coalesce(max(version), 0) into v_max_version
  from public.menu_publications
  where branch_id = v_branch;

  v_version := v_max_version + 1;

  begin
    insert into public.menu_publications (
      branch_id, version, status, actor_id, actor_email, idempotency_key,
      change_summary, snapshot, snapshot_fingerprint, published_at
    ) values (
      v_branch, v_version, 'publishing', auth.uid(), v_email, p_idempotency_key,
      coalesce(p_change_summary, '{}'::jsonb), v_snapshot, v_fingerprint, now()
    )
    returning * into v_row;
  exception
    when unique_violation then
      select * into v_row
      from public.menu_publications
      where branch_id = v_branch and version = v_version;

      if not found then
        select * into v_row
        from public.menu_publications
        where branch_id = v_branch and snapshot_fingerprint = v_fingerprint
        order by version desc
        limit 1;
      end if;

      if not found and p_idempotency_key is not null then
        select * into v_row
        from public.menu_publications
        where branch_id = v_branch and idempotency_key = p_idempotency_key;
      end if;

      if not found then
        raise exception
          'Menu publish conflict for branch %. Please retry publish.',
          v_branch;
      end if;

      return to_jsonb(v_row) || jsonb_build_object('reused', true);
  end;

  insert into public.menu_audit_log (
    publication_id, branch_id, actor_id, actor_email, action, entity_type,
    entity_id, changed_fields, publication_version, result
  ) values (
    v_row.id, v_branch, auth.uid(), v_email,
    coalesce(p_change_summary ->> 'action', 'publish'),
    p_change_summary ->> 'entity_type', p_change_summary ->> 'entity_id',
    coalesce(p_change_summary -> 'changed_fields', p_change_summary),
    v_row.version, 'publishing'
  );

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.publish_menu_branch(text, jsonb, text) from public, anon;
grant execute on function public.publish_menu_branch(text, jsonb, text) to authenticated;
