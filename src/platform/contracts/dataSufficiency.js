/**
 * Central thresholds — predictive / executive surfaces should not over-render on sparse data.
 */

export const DATA_SUFFICIENCY = {
  menu: {
    minEvents: 12,
    minSessions: 8,
    minEventsForHourlyChart: 6,
    minPopulatedHourBuckets: 2,
    minDaysForTrend: 3,
  },
  review: {
    minCardTaps: 8,
    minActiveStaff: 2,
  },
  predictive: {
    minTrendPoints: 3,
    minSessionsForDemand: 15,
  },
  platform: {
    sparseSessionMax: 7,
    sparseEventMax: 19,
    baselineSessionMax: 4,
    baselineEventMax: 11,
  },
};

/** @param {object} [data] normalized BI payload */
export function assessMenuBiSufficiency(data = null, rangeContract = {}) {
  const events = Number(data?.total_events) || 0;
  const sessions = Number(data?.total_sessions) || 0;
  const byHour = data?.by_hour || [];
  const populatedHours = byHour.filter((r) => (Number(r.count) || 0) > 0).length;
  const rangeId = rangeContract?.id || rangeContract?.rangeId || "today";
  const isLongRange = rangeId === "7d" || rangeId === "month";

  const insufficientEvents = events < DATA_SUFFICIENCY.menu.minEvents;
  const insufficientSessions = sessions < DATA_SUFFICIENCY.menu.minSessions;
  const insufficientHourly =
    !isLongRange &&
    events >= DATA_SUFFICIENCY.menu.minEventsForHourlyChart &&
    populatedHours < DATA_SUFFICIENCY.menu.minPopulatedHourBuckets;

  const sparse =
    insufficientEvents ||
    insufficientSessions ||
    events <= DATA_SUFFICIENCY.platform.sparseEventMax ||
    sessions <= DATA_SUFFICIENCY.platform.sparseSessionMax;

  const baselineBuilding =
    !sparse &&
    (events <= DATA_SUFFICIENCY.platform.baselineEventMax ||
      sessions <= DATA_SUFFICIENCY.platform.baselineSessionMax);

  return {
    sufficient: !sparse && !insufficientHourly,
    sparse,
    baselineBuilding,
    insufficientEvents,
    insufficientSessions,
    insufficientHourly,
    events,
    sessions,
    populatedHours,
    rangeId,
  };
}

export function isMenuBiSparse(data, rangeContract) {
  return assessMenuBiSufficiency(data, rangeContract).sparse;
}

export const SCORE_MIN_CARD_TAPS = DATA_SUFFICIENCY.review.minCardTaps;
export const SCORE_MIN_STAFF_ACTIVE = DATA_SUFFICIENCY.review.minActiveStaff;
