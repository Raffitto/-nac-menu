/**
 * Session behavior — quality tiers, engagement, and BI mapping.
 */

export {
  buildSessionMap,
  classifySessionTier,
  aggregateSessionQualityFromRows,
  sessionQualityIsEmpty,
  sessionQualityTierSum,
} from "../../lib/sessionQualityAggregate";

export {
  mapBiToSessionAggregates,
  mapBiTopAddons,
} from "../../dashboard/utils/sessionAnalyticsMap";

import { sessionQualityIsEmpty } from "../../lib/sessionQualityAggregate";

/** Whether session-quality block should be treated as sparse / building. */
export function isSessionDataSparse(payload) {
  const sessions = Number(payload?.total_sessions) || 0;
  if (sessions < 5) return true;
  return sessionQualityIsEmpty(payload);
}
