-- Visibility analytics: item_impression support for get_bi_dashboard
-- Run in Supabase SQL Editor AFTER analytics_dashboard_setup.sql
--
-- In get_bi_dashboard, REPLACE the existing 'top_items' jsonb_agg block with the query below.
-- Also add item_impression counts to session_stats if desired.

-- Optional helper view
create or replace view public.menu_item_visibility_stats as
select
  item_name_en as name,
  count(*) filter (where event_type = 'item_impression') as impressions,
  count(*) filter (where event_type = 'item_open') as modal_opens,
  count(distinct session_id) filter (where event_type = 'item_impression') as impression_sessions,
  coalesce(sum((metadata->>'visible_duration_ms')::numeric) filter (where event_type = 'item_impression_end'), 0)::bigint as visible_duration_ms
from public.menu_events
where coalesce(trim(item_name_en), '') <> ''
group by item_name_en;

grant select on public.menu_item_visibility_stats to authenticated;

-- === top_items block for get_bi_dashboard ===
/*
    'top_items', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', m.name,
            'impressions', m.impressions,
            'opens', m.opens,
            'impression_sessions', m.impression_sessions,
            'visible_duration_ms', m.visible_duration_ms
          )
          ORDER BY GREATEST(m.impressions, m.opens) DESC NULLS LAST
        )
        FROM (
          SELECT
            coalesce(i.name, o.name) AS name,
            coalesce(i.impressions, 0) AS impressions,
            coalesce(o.opens, 0) AS opens,
            coalesce(i.impression_sessions, 0) AS impression_sessions,
            coalesce(d.visible_duration_ms, 0) AS visible_duration_ms
          FROM (
            SELECT item_name_en AS name,
              count(*)::bigint AS impressions,
              count(distinct session_id)::bigint AS impression_sessions
            FROM filtered
            WHERE event_type = 'item_impression'
              AND coalesce(trim(item_name_en), '') <> ''
            GROUP BY item_name_en
          ) i
          FULL OUTER JOIN (
            SELECT item_name_en AS name, count(*)::bigint AS opens
            FROM filtered
            WHERE event_type = 'item_open'
              AND coalesce(trim(item_name_en), '') <> ''
            GROUP BY item_name_en
          ) o ON i.name = o.name
          LEFT JOIN (
            SELECT item_name_en AS name,
              coalesce(sum((metadata->>'visible_duration_ms')::numeric), 0)::bigint AS visible_duration_ms
            FROM filtered
            WHERE event_type = 'item_impression_end'
              AND coalesce(trim(item_name_en), '') <> ''
            GROUP BY item_name_en
          ) d ON coalesce(i.name, o.name) = d.name
          ORDER BY GREATEST(coalesce(i.impressions, 0), coalesce(o.opens, 0)) DESC
          LIMIT 40
        ) m
      ),
      '[]'::jsonb
    ),
*/
