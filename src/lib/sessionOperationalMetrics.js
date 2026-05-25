/**
 * Operational session metrics derived from live menu_events session map.
 */

import { safePct } from "../dashboard/utils/intelligenceSanity";

export function computeSessionOperationalMetrics(sessionMap) {
  if (!sessionMap || sessionMap.size === 0) {
    return {
      avg_categories_per_session: 0,
      avg_dishes_per_session: 0,
      avg_impressions_per_session: 0,
      impression_to_open_ratio: 0,
      reopen_rate_pct: 0,
      return_frequency_pct: 0,
      menu_completion_pct: 0,
    };
  }

  let catSum = 0;
  let dishSum = 0;
  let impSum = 0;
  let reopenSessions = 0;
  let completed = 0;

  for (const s of sessionMap.values()) {
    catSum += s.categoryOpens || 0;
    dishSum += s.itemOpens || 0;
    impSum += s.impressions || 0;
    if (s.itemOpens >= 2) reopenSessions += 1;
    if (s.categoryOpens >= 1 && s.itemOpens >= 1 && (s.addonClicks || 0) >= 1) {
      completed += 1;
    }
  }

  const n = sessionMap.size;
  const round1 = (v) => Math.round(v * 10) / 10;

  return {
    avg_categories_per_session: round1(catSum / n),
    avg_dishes_per_session: round1(dishSum / n),
    avg_impressions_per_session: round1(impSum / n),
    impression_to_open_ratio: safePct(dishSum, impSum, { decimals: 1 }),
    reopen_rate_pct: safePct(reopenSessions, n, { decimals: 1 }),
    return_frequency_pct: safePct(reopenSessions, n, { decimals: 1 }),
    menu_completion_pct: safePct(completed, n, { decimals: 1 }),
  };
}
