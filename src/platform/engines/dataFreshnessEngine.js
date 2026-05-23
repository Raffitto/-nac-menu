/**
 * Global data freshness timestamps for NAC OS pipelines.
 */

const freshness = {
  lastRpcRefreshAt: null,
  lastRollupRefreshAt: null,
  lastMenuEventAt: null,
  lastReviewEventAt: null,
  lastClientTrackAt: null,
  lastBiFetchAt: null,
};

export function getDataFreshness() {
  return { ...freshness };
}

export function recordRpcRefresh({ dataSource, at } = {}) {
  const ts = at || new Date().toISOString();
  freshness.lastRpcRefreshAt = ts;
  freshness.lastBiFetchAt = ts;
  if (dataSource === "rollup") freshness.lastRollupRefreshAt = ts;
}

export function recordLastMenuEventAt(iso) {
  if (!iso) return;
  freshness.lastMenuEventAt = iso;
}

export function recordLastReviewEventAt(iso) {
  if (!iso) return;
  freshness.lastReviewEventAt = iso;
}

export function recordClientTrackAt(iso) {
  freshness.lastClientTrackAt = iso || new Date().toISOString();
}

/** Human labels for integrity panel. */
export function formatFreshnessSnapshot(snap = freshness) {
  const fmt = (iso) => {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Riyadh",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const ageMinutes = (iso) => {
    if (!iso) return null;
    return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  };

  return {
    last_rpc_refresh: snap.lastRpcRefreshAt,
    last_rpc_refresh_label: fmt(snap.lastRpcRefreshAt),
    last_rpc_age_min: ageMinutes(snap.lastRpcRefreshAt),
    last_rollup_refresh: snap.lastRollupRefreshAt,
    last_rollup_refresh_label: fmt(snap.lastRollupRefreshAt),
    last_menu_event: snap.lastMenuEventAt,
    last_menu_event_label: fmt(snap.lastMenuEventAt),
    last_menu_event_age_min: ageMinutes(snap.lastMenuEventAt),
    last_review_event: snap.lastReviewEventAt,
    last_review_event_label: fmt(snap.lastReviewEventAt),
    last_review_event_age_min: ageMinutes(snap.lastReviewEventAt),
    last_client_track: snap.lastClientTrackAt,
    last_client_track_label: fmt(snap.lastClientTrackAt),
    last_bi_fetch: snap.lastBiFetchAt,
    last_bi_fetch_label: fmt(snap.lastBiFetchAt),
    last_rollup_age_min: ageMinutes(snap.lastRollupRefreshAt),
    last_client_track_age_min: ageMinutes(snap.lastClientTrackAt),
  };
}

/**
 * Optional Supabase probes for latest row timestamps (staff session).
 */
export async function probeLatestEventTimestamps(supabase) {
  if (!supabase) return {};

  const out = {};
  try {
    const menuRes = await supabase
      .from("menu_events")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (menuRes.data?.created_at) {
      recordLastMenuEventAt(menuRes.data.created_at);
      out.menu = menuRes.data.created_at;
    }
  } catch {
    /* RLS / offline */
  }

  try {
    const reviewRes = await supabase
      .from("review_events")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reviewRes.data?.created_at) {
      recordLastReviewEventAt(reviewRes.data.created_at);
      out.review = reviewRes.data.created_at;
    }
  } catch {
    /* ignore */
  }

  return out;
}
