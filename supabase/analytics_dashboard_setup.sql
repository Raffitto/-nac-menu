-- NAC menu analytics dashboard: RLS + RPC
-- Run once in Supabase SQL Editor after your original menu_events table + anon insert policy exist.

-- ---------------------------------------------------------------------------
-- 1) Allow authenticated users to read menu_events (dashboard only)
-- ---------------------------------------------------------------------------
grant select on public.menu_events to authenticated;

drop policy if exists "authenticated_select_menu_events" on public.menu_events;
create policy "authenticated_select_menu_events"
  on public.menu_events
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2) Allow inserts as authenticated too (optional: staff stays signed in while testing the guest menu)
-- ---------------------------------------------------------------------------
drop policy if exists "anon_insert_menu_events" on public.menu_events;
drop policy if exists "menu_events_insert_anon_authenticated" on public.menu_events;

create policy "menu_events_insert_anon_authenticated"
  on public.menu_events
  for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 3) Server-side aggregates for the dashboard (one round trip; SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_aggregates()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'total_events', (select count(*)::bigint from public.menu_events),
    'total_sessions', (
      select count(distinct session_id)::bigint
      from public.menu_events
      where coalesce(trim(session_id), '') <> ''
    ),
    'by_language', coalesce(
      (
        select jsonb_object_agg(language_key, cnt)
        from (
          select coalesce(nullif(trim(language), ''), 'unknown') as language_key, count(*)::bigint as cnt
          from public.menu_events
          group by 1
        ) s
      ),
      '{}'::jsonb
    ),
    'by_event_type', coalesce(
      (
        select jsonb_object_agg(event_type, cnt)
        from (
          select event_type, count(*)::bigint as cnt
          from public.menu_events
          group by 1
        ) t
      ),
      '{}'::jsonb
    ),
    'top_items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('name', u.name, 'opens', u.opens)
          ORDER BY u.opens DESC NULLS LAST
        )
        from (
          select item_name_en as name, count(*)::bigint as opens
          from public.menu_events
          where event_type = 'item_open'
            and coalesce(trim(item_name_en), '') <> ''
          group by item_name_en
          order by opens desc
          limit 12
        ) u
      ),
      '[]'::jsonb
    ),
    'top_categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', v.id, 'opens', v.opens)
          ORDER BY v.opens DESC NULLS LAST
        )
        from (
          select category_id as id, count(*)::bigint as opens
          from public.menu_events
          where event_type = 'category_open'
            and category_id is not null
          group by category_id
          order by opens desc
          limit 10
        ) v
      ),
      '[]'::jsonb
    ),
    'by_hour', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('hour', w.hour_bucket, 'count', w.c)
          ORDER BY w.hour_bucket
        )
        from (
          select date_trunc('hour', created_at) as hour_bucket, count(*)::bigint as c
          from public.menu_events
          where created_at > now() - interval '24 hours'
          group by 1
          order by 1
        ) w
      ),
      '[]'::jsonb
    ),
    'today_unique_sessions', (
      select count(distinct session_id)::bigint
      from public.menu_events
      where created_at >= date_trunc('day', now())
        and coalesce(trim(session_id), '') <> ''
    ),
    'today_qr_sessions', (
      select count(*)::bigint
      from public.menu_events
      where event_type = 'qr_session_start'
        and created_at >= date_trunc('day', now())
    ),
    'avg_time_spent', (
      select round(avg(
        (metadata->>'duration_seconds')::numeric
      ))::bigint
      from public.menu_events
      where event_type = 'time_spent'
        and metadata->>'duration_seconds' is not null
        and (metadata->>'duration_seconds')::numeric > 0
    ),
    'avg_items_per_session', (
      select round(avg(item_cnt)::numeric, 1)
      from (
        select session_id, count(*)::numeric as item_cnt
        from public.menu_events
        where event_type = 'item_open'
          and coalesce(trim(session_id), '') <> ''
        group by session_id
      ) x
    ),
    'bounce_sessions', (
      select count(*)::bigint
      from (
        select session_id
        from public.menu_events
        where coalesce(trim(session_id), '') <> ''
        group by session_id
        having count(*) <= 2
          and count(*) filter (
            where event_type in ('item_open','category_open','search_used','search_submit','add_on_click')
          ) = 0
      ) b
    ),
    'deep_sessions', (
      select count(*)::bigint
      from (
        select session_id
        from public.menu_events
        where coalesce(trim(session_id), '') <> ''
        group by session_id
        having count(*) >= 8
      ) d
    ),
    'top_searches', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('query', sq.q, 'count', sq.cnt)
          ORDER BY sq.cnt DESC NULLS LAST
        )
        from (
          select lower(trim(search_query)) as q, count(*)::bigint as cnt
          from public.menu_events
          where event_type in ('search_used', 'search_submit')
            and coalesce(trim(search_query), '') <> ''
          group by 1
          order by cnt desc
          limit 10
        ) sq
      ),
      '[]'::jsonb
    ),
    'returning_sessions', (
      select count(*)::bigint
      from public.menu_events
      where event_type = 'qr_session_start'
        and metadata->>'returning' = 'true'
    ),
    'modal_engagement_events', (
      select count(*)::bigint
      from public.menu_events
      where event_type in ('modal_drag_close', 'item_navigation')
    ),
    'top_addon_pairs', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('item', ap.item, 'addon', ap.addon, 'clicks', ap.clicks)
          ORDER BY ap.clicks DESC NULLS LAST
        )
        from (
          select
            coalesce(nullif(trim(item_name_en), ''), 'Unknown item') as item,
            coalesce(nullif(trim(add_on_name), ''), 'Unknown add-on') as addon,
            count(*)::bigint as clicks
          from public.menu_events
          where event_type = 'add_on_click'
            and (coalesce(trim(item_name_en), '') <> '' or coalesce(trim(add_on_name), '') <> '')
          group by 1, 2
          order by clicks desc
          limit 12
        ) ap
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_dashboard_aggregates() from public;
grant execute on function public.get_dashboard_aggregates() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) BI Dashboard: filtered aggregates with advanced analytics
-- ---------------------------------------------------------------------------
create or replace function public.get_bi_dashboard(
  p_branch text default null,
  p_hours int default 0
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  WITH filtered AS (
    SELECT * FROM public.menu_events
    WHERE (p_branch IS NULL OR branch_id = p_branch)
      AND (p_hours = 0 OR created_at > now() - make_interval(hours => p_hours))
  ),
  session_stats AS (
    SELECT
      session_id,
      count(*)::int AS total,
      count(*) FILTER (WHERE event_type = 'item_open')::int AS item_opens,
      count(*) FILTER (WHERE event_type = 'add_on_click')::int AS addon_clicks,
      count(*) FILTER (WHERE event_type IN ('search_used', 'search_submit'))::int AS searches,
      max((metadata->>'duration_seconds')::numeric) FILTER (WHERE event_type = 'time_spent') AS duration
    FROM filtered
    WHERE coalesce(trim(session_id), '') <> ''
    GROUP BY session_id
  ),
  session_quality AS (
    SELECT
      CASE
        WHEN total <= 2 AND item_opens = 0 THEN 'bounce'
        WHEN total <= 4 AND item_opens <= 1 THEN 'casual'
        WHEN total >= 12 OR (item_opens >= 5 AND addon_clicks >= 2) THEN 'power'
        WHEN total >= 8 OR (item_opens >= 3 AND (addon_clicks > 0 OR searches > 0)) THEN 'deep'
        ELSE 'engaged'
      END AS quality
    FROM session_stats
  ),
  session_lang AS (
    SELECT
      session_id,
      mode() WITHIN GROUP (ORDER BY coalesce(nullif(trim(language), ''), 'unknown')) AS dominant_lang
    FROM filtered
    WHERE coalesce(trim(session_id), '') <> ''
    GROUP BY session_id
  )
  SELECT jsonb_build_object(
    'total_events', (SELECT count(*)::bigint FROM filtered),
    'total_sessions', (
      SELECT count(distinct session_id)::bigint
      FROM filtered
      WHERE coalesce(trim(session_id), '') <> ''
    ),
    'by_language', coalesce(
      (
        SELECT jsonb_object_agg(language_key, cnt)
        FROM (
          SELECT coalesce(nullif(trim(language), ''), 'unknown') AS language_key, count(*)::bigint AS cnt
          FROM filtered
          GROUP BY 1
        ) s
      ),
      '{}'::jsonb
    ),
    'by_event_type', coalesce(
      (
        SELECT jsonb_object_agg(event_type, cnt)
        FROM (
          SELECT event_type, count(*)::bigint AS cnt
          FROM filtered
          GROUP BY 1
        ) t
      ),
      '{}'::jsonb
    ),
    'top_items', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('name', u.name, 'opens', u.opens)
          ORDER BY u.opens DESC NULLS LAST
        )
        FROM (
          SELECT item_name_en AS name, count(*)::bigint AS opens
          FROM filtered
          WHERE event_type = 'item_open'
            AND coalesce(trim(item_name_en), '') <> ''
          GROUP BY item_name_en
          ORDER BY opens DESC
          LIMIT 12
        ) u
      ),
      '[]'::jsonb
    ),
    'top_categories', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('id', v.id, 'opens', v.opens)
          ORDER BY v.opens DESC NULLS LAST
        )
        FROM (
          SELECT category_id AS id, count(*)::bigint AS opens
          FROM filtered
          WHERE event_type = 'category_open'
            AND category_id IS NOT NULL
          GROUP BY category_id
          ORDER BY opens DESC
          LIMIT 10
        ) v
      ),
      '[]'::jsonb
    ),
    'by_hour', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('hour', w.hour_bucket, 'count', w.c)
          ORDER BY w.hour_bucket
        )
        FROM (
          SELECT date_trunc('hour', created_at) AS hour_bucket, count(*)::bigint AS c
          FROM filtered
          WHERE created_at > now() - interval '24 hours'
          GROUP BY 1
          ORDER BY 1
        ) w
      ),
      '[]'::jsonb
    ),
    'today_unique_sessions', (
      SELECT count(distinct session_id)::bigint
      FROM filtered
      WHERE created_at >= date_trunc('day', now())
        AND coalesce(trim(session_id), '') <> ''
    ),
    'today_qr_sessions', (
      SELECT count(*)::bigint
      FROM filtered
      WHERE event_type = 'qr_session_start'
        AND created_at >= date_trunc('day', now())
    ),
    'avg_time_spent', coalesce(
      (
        SELECT round(avg(
          (metadata->>'duration_seconds')::numeric
        ))::bigint
        FROM filtered
        WHERE event_type = 'time_spent'
          AND metadata->>'duration_seconds' IS NOT NULL
          AND (metadata->>'duration_seconds')::numeric > 0
      ),
      0
    ),
    'avg_items_per_session', coalesce(
      (
        SELECT round(avg(item_cnt)::numeric, 1)
        FROM (
          SELECT session_id, count(*)::numeric AS item_cnt
          FROM filtered
          WHERE event_type = 'item_open'
            AND coalesce(trim(session_id), '') <> ''
          GROUP BY session_id
        ) x
      ),
      0
    ),
    'bounce_sessions', (
      SELECT count(*)::bigint
      FROM (
        SELECT session_id
        FROM filtered
        WHERE coalesce(trim(session_id), '') <> ''
        GROUP BY session_id
        HAVING count(*) <= 2
          AND count(*) FILTER (
            WHERE event_type IN ('item_open','category_open','search_used','search_submit','add_on_click')
          ) = 0
      ) b
    ),
    'deep_sessions', (
      SELECT count(*)::bigint
      FROM (
        SELECT session_id
        FROM filtered
        WHERE coalesce(trim(session_id), '') <> ''
        GROUP BY session_id
        HAVING count(*) >= 8
      ) d
    ),
    'top_searches', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('query', sq.q, 'count', sq.cnt)
          ORDER BY sq.cnt DESC NULLS LAST
        )
        FROM (
          SELECT lower(trim(search_query)) AS q, count(*)::bigint AS cnt
          FROM filtered
          WHERE event_type IN ('search_used', 'search_submit')
            AND coalesce(trim(search_query), '') <> ''
          GROUP BY 1
          ORDER BY cnt DESC
          LIMIT 10
        ) sq
      ),
      '[]'::jsonb
    ),
    'returning_sessions', (
      SELECT count(*)::bigint
      FROM filtered
      WHERE event_type = 'qr_session_start'
        AND metadata->>'returning' = 'true'
    ),
    'modal_engagement_events', (
      SELECT count(*)::bigint
      FROM filtered
      WHERE event_type IN ('modal_drag_close', 'item_navigation')
    ),
    'top_addon_pairs', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('item', ap.item, 'addon', ap.addon, 'clicks', ap.clicks)
          ORDER BY ap.clicks DESC NULLS LAST
        )
        FROM (
          SELECT
            coalesce(nullif(trim(item_name_en), ''), 'Unknown item') AS item,
            coalesce(nullif(trim(add_on_name), ''), 'Unknown add-on') AS addon,
            count(*)::bigint AS clicks
          FROM filtered
          WHERE event_type = 'add_on_click'
            AND (coalesce(trim(item_name_en), '') <> '' OR coalesce(trim(add_on_name), '') <> '')
          GROUP BY 1, 2
          ORDER BY clicks DESC
          LIMIT 12
        ) ap
      ),
      '[]'::jsonb
    ),
    'funnel', jsonb_build_object(
      'qr_scans', (SELECT count(distinct session_id)::bigint FROM filtered WHERE event_type = 'qr_session_start'),
      'category_opens', (SELECT count(distinct session_id)::bigint FROM filtered WHERE event_type = 'category_open'),
      'item_opens', (SELECT count(distinct session_id)::bigint FROM filtered WHERE event_type = 'item_open'),
      'addon_clicks', (SELECT count(distinct session_id)::bigint FROM filtered WHERE event_type = 'add_on_click'),
      'time_spent', (SELECT count(distinct session_id)::bigint FROM filtered WHERE event_type = 'time_spent'),
      'exits', (SELECT count(distinct session_id)::bigint FROM filtered WHERE event_type = 'menu_exit')
    ),
    'dead_zones', coalesce(
      (
        SELECT jsonb_agg(row_to_json(dz)::jsonb ORDER BY dz.engagement_ratio ASC NULLS LAST)
        FROM (
          SELECT
            category_id,
            count(*) FILTER (WHERE event_type = 'category_open')::bigint AS opens,
            count(*) FILTER (WHERE event_type = 'item_open')::bigint AS item_opens,
            count(*) FILTER (WHERE event_type = 'menu_exit')::bigint AS exits,
            round(
              (count(*) FILTER (WHERE event_type = 'item_open')::numeric
               / NULLIF(count(*) FILTER (WHERE event_type = 'category_open'), 0)) * 100,
              1
            ) AS engagement_ratio
          FROM filtered
          WHERE category_id IS NOT NULL
          GROUP BY category_id
          HAVING count(*) FILTER (WHERE event_type = 'category_open') >= 3
          ORDER BY engagement_ratio ASC NULLS LAST
          LIMIT 10
        ) dz
      ),
      '[]'::jsonb
    ),
    'lost_searches', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object('query', ls.q, 'sessions', ls.sess_count)
          ORDER BY ls.sess_count DESC NULLS LAST
        )
        FROM (
          SELECT
            lower(trim(search_query)) AS q,
            count(distinct session_id)::bigint AS sess_count
          FROM filtered
          WHERE event_type IN ('search_used', 'search_submit')
            AND coalesce(trim(search_query), '') <> ''
            AND NOT EXISTS (
              SELECT 1 FROM filtered f2
              WHERE f2.session_id = filtered.session_id
                AND f2.event_type = 'item_open'
            )
          GROUP BY 1
          ORDER BY sess_count DESC
          LIMIT 10
        ) ls
      ),
      '[]'::jsonb
    ),
    'session_quality', jsonb_build_object(
      'bounce', (SELECT count(*)::bigint FROM session_quality WHERE quality = 'bounce'),
      'casual', (SELECT count(*)::bigint FROM session_quality WHERE quality = 'casual'),
      'engaged', (SELECT count(*)::bigint FROM session_quality WHERE quality = 'engaged'),
      'deep', (SELECT count(*)::bigint FROM session_quality WHERE quality = 'deep'),
      'power', (SELECT count(*)::bigint FROM session_quality WHERE quality = 'power')
    ),
    'lang_behavior', jsonb_build_object(
      'en', jsonb_build_object(
        'sessions', (SELECT count(*)::bigint FROM session_lang WHERE dominant_lang = 'en'),
        'avg_events', coalesce(
          (
            SELECT round(avg(total)::numeric, 1)
            FROM session_stats
            WHERE session_id IN (SELECT session_id FROM session_lang WHERE dominant_lang = 'en')
          ),
          0
        ),
        'avg_duration', coalesce(
          (
            SELECT round(avg(duration))::bigint
            FROM session_stats
            WHERE session_id IN (SELECT session_id FROM session_lang WHERE dominant_lang = 'en')
              AND duration IS NOT NULL
          ),
          0
        )
      ),
      'ar', jsonb_build_object(
        'sessions', (SELECT count(*)::bigint FROM session_lang WHERE dominant_lang = 'ar'),
        'avg_events', coalesce(
          (
            SELECT round(avg(total)::numeric, 1)
            FROM session_stats
            WHERE session_id IN (SELECT session_id FROM session_lang WHERE dominant_lang = 'ar')
          ),
          0
        ),
        'avg_duration', coalesce(
          (
            SELECT round(avg(duration))::bigint
            FROM session_stats
            WHERE session_id IN (SELECT session_id FROM session_lang WHERE dominant_lang = 'ar')
              AND duration IS NOT NULL
          ),
          0
        )
      )
    ),
    'strongest_hour', (
      SELECT extract(hour from created_at)::int
      FROM filtered
      WHERE created_at > now() - interval '24 hours'
      GROUP BY extract(hour from created_at)
      ORDER BY count(*) DESC
      LIMIT 1
    ),
    'top_converting_category', coalesce(
      (
        SELECT jsonb_build_object(
          'id', tc.category_id,
          'ratio', round((tc.io::numeric / tc.co) * 100, 1),
          'item_opens', tc.io,
          'cat_opens', tc.co
        )
        FROM (
          SELECT
            category_id,
            count(*) FILTER (WHERE event_type = 'item_open')::bigint AS io,
            count(*) FILTER (WHERE event_type = 'category_open')::bigint AS co
          FROM filtered
          WHERE category_id IS NOT NULL
          GROUP BY category_id
          HAVING count(*) FILTER (WHERE event_type = 'category_open') >= 5
          ORDER BY (count(*) FILTER (WHERE event_type = 'item_open')::numeric
                    / count(*) FILTER (WHERE event_type = 'category_open')) DESC
          LIMIT 1
        ) tc
      ),
      '{}'::jsonb
    )
  );
$$;

revoke all on function public.get_bi_dashboard(text, int) from public;
grant execute on function public.get_bi_dashboard(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Live activity snapshot (last 5-10 minutes)
-- ---------------------------------------------------------------------------
create or replace function public.get_live_activity()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  SELECT jsonb_build_object(
    'active_sessions', (
      SELECT count(distinct session_id)::bigint
      FROM public.menu_events
      WHERE created_at > now() - interval '5 minutes'
        AND coalesce(trim(session_id), '') <> ''
    ),
    'active_languages', coalesce(
      (
        SELECT jsonb_object_agg(lang, sess_count)
        FROM (
          SELECT
            coalesce(nullif(trim(language), ''), 'unknown') AS lang,
            count(distinct session_id)::bigint AS sess_count
          FROM public.menu_events
          WHERE created_at > now() - interval '5 minutes'
            AND coalesce(trim(session_id), '') <> ''
          GROUP BY 1
        ) al
      ),
      '{}'::jsonb
    ),
    'hot_category', (
      SELECT category_id
      FROM public.menu_events
      WHERE event_type = 'category_open'
        AND category_id IS NOT NULL
        AND created_at > now() - interval '10 minutes'
      GROUP BY category_id
      ORDER BY count(*) DESC
      LIMIT 1
    ),
    'recent_items', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', ri.item_name_en,
            'category', ri.category_id,
            'language', ri.language,
            'at', ri.created_at
          )
          ORDER BY ri.created_at DESC
        )
        FROM (
          SELECT item_name_en, category_id, language, created_at
          FROM public.menu_events
          WHERE event_type = 'item_open'
            AND created_at > now() - interval '10 minutes'
            AND coalesce(trim(item_name_en), '') <> ''
          ORDER BY created_at DESC
          LIMIT 8
        ) ri
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.get_live_activity() from public;
grant execute on function public.get_live_activity() to authenticated;
