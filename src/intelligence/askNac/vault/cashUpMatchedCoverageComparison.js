/**
 * Coverage-aware Cash Up current vs previous comparison.
 * Partial windows never headline-compare unequal day totals.
 */

function calendarDayOffset(startDate, date) {
  if (!startDate || !date) return null;
  const start = new Date(`${startDate}T12:00:00`);
  const day = new Date(`${date}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(day.getTime())) return null;
  return Math.round((day.getTime() - start.getTime()) / 86400000);
}

function sumDailyField(rows, key) {
  const values = (rows || []).map((row) => row?.[key]).filter((v) => v != null && Number.isFinite(Number(v)));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function aggregateMatchedDailyRows(rows = []) {
  const totalSales = sumDailyField(rows, "totalSales");
  const totalGuests = sumDailyField(rows, "totalGuests");
  const totalOrders = sumDailyField(rows, "totalOrders");
  const totalDeliverySales = sumDailyField(rows, "totalDeliverySales");
  const totalDeliveryOrders = sumDailyField(rows, "totalDeliveryOrders");
  let averageSpend = null;
  if (totalSales != null && totalGuests != null && totalGuests > 0) {
    averageSpend = totalSales / totalGuests;
  }
  return {
    totalSales,
    totalGuests,
    totalOrders,
    averageSpend,
    totalDeliverySales,
    totalDeliveryOrders,
    dayCount: rows.length,
    dailyBreakdown: rows,
  };
}

function averageDailyMetric(total, dayCount) {
  if (total == null || !dayCount) return null;
  return Number(total) / Number(dayCount);
}

export function resolveExpectedDayCount(aggregation) {
  if (!aggregation) return null;
  if (aggregation.expectedDayCount) return Number(aggregation.expectedDayCount);
  const start = aggregation.requestedStartDate;
  const end = aggregation.requestedEndDate;
  if (!start || !end) return null;
  const startMs = new Date(`${start}T12:00:00`).getTime();
  const endMs = new Date(`${end}T12:00:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

export function buildMatchedCoverageComparison(current, previous) {
  if (!current || !previous) {
    return { mode: "unavailable", reason: "missing_aggregation", likeForLike: false };
  }

  const expected = resolveExpectedDayCount(current);
  const currentDays = current.dayCount || 0;
  const previousDays = previous.dayCount || 0;
  const isPartial = expected != null && currentDays > 0 && currentDays < expected;
  const dayMismatch = currentDays > 0 && previousDays > 0 && currentDays !== previousDays;
  const needsMatch = isPartial || dayMismatch;

  const avgPair = {
    currentAvgDailySales: averageDailyMetric(current.totalSales, currentDays),
    previousAvgDailySales: averageDailyMetric(previous.totalSales, previousDays),
    currentObservedDayCount: currentDays,
    previousObservedDayCount: previousDays,
    expectedDayCount: expected,
    missingCurrentDayCount: expected != null ? Math.max(0, expected - currentDays) : null,
  };

  if (!needsMatch) {
    return {
      mode: "full",
      likeForLike: true,
      current,
      previous,
      ...avgPair,
    };
  }

  const currentBreakdown = current.dailyBreakdown || [];
  const previousBreakdown = previous.dailyBreakdown || [];
  const currentStart = current.requestedStartDate;
  const previousStart = previous.requestedStartDate;

  if (!currentBreakdown.length || !previousBreakdown.length || !currentStart || !previousStart) {
    return {
      mode: "unavailable",
      reason: "missing_daily_breakdown",
      likeForLike: false,
      isPartial: true,
      ...avgPair,
    };
  }

  const previousByOffset = new Map();
  for (const row of previousBreakdown) {
    const offset = calendarDayOffset(previousStart, row.date);
    if (offset == null) continue;
    previousByOffset.set(offset, row);
  }

  const matchedCurrent = [];
  const matchedPrevious = [];
  for (const row of currentBreakdown) {
    if (row?.totalSales == null || !Number.isFinite(Number(row.totalSales))) continue;
    const offset = calendarDayOffset(currentStart, row.date);
    if (offset == null) continue;
    const previousRow = previousByOffset.get(offset);
    if (!previousRow || previousRow.totalSales == null || !Number.isFinite(Number(previousRow.totalSales))) {
      continue;
    }
    matchedCurrent.push(row);
    matchedPrevious.push(previousRow);
  }

  if (!matchedCurrent.length) {
    return {
      mode: "unavailable",
      reason: "no_matched_days",
      likeForLike: false,
      isPartial: true,
      ...avgPair,
    };
  }

  return {
    mode: "matched",
    likeForLike: true,
    isPartial: true,
    matchedDayCount: matchedCurrent.length,
    currentMatched: aggregateMatchedDailyRows(matchedCurrent),
    previousMatched: aggregateMatchedDailyRows(matchedPrevious),
    ...avgPair,
  };
}
