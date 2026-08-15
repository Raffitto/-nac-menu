/**
 * Coverage-aware Cash Up current vs previous comparison.
 * Partial windows never headline-compare unequal day totals.
 * Matched pairs are the single comparison population for totals, breadth, and contributors.
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

function dailySpend(sales, covers) {
  if (sales == null || covers == null || covers <= 0) return null;
  return sales / covers;
}

function numField(row, ...keys) {
  if (!row) return null;
  for (const key of keys) {
    const v = row[key];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

export function pairDailyBreakdownsByOffset(current, previous) {
  if (!current || !previous) return [];
  const currentBreakdown = current.dailyBreakdown || [];
  const previousBreakdown = previous.dailyBreakdown || [];
  const currentStart = String(current.requestedStartDate || current.startDate || "");
  const previousStart = String(previous.requestedStartDate || previous.startDate || "");
  if (!currentBreakdown.length || !previousBreakdown.length || !currentStart || !previousStart) return [];

  const previousByOffset = new Map();
  for (const row of previousBreakdown) {
    const offset = calendarDayOffset(previousStart, String(row.date || ""));
    if (offset == null) continue;
    previousByOffset.set(offset, row);
  }

  const pairs = [];
  for (const row of currentBreakdown) {
    const currentSales = numField(row, "totalSales", "net_sales", "sales");
    if (currentSales == null) continue;
    const offset = calendarDayOffset(currentStart, String(row.date || ""));
    if (offset == null) continue;
    const previousRow = previousByOffset.get(offset);
    const previousSales = numField(previousRow, "totalSales", "net_sales", "sales");
    if (!previousRow || previousSales == null) continue;
    const currentCovers = numField(row, "totalGuests", "covers", "guest_count");
    const previousCovers = numField(previousRow, "totalGuests", "covers", "guest_count");
    const currentOrders = numField(row, "totalOrders", "orders", "order_count");
    const previousOrders = numField(previousRow, "totalOrders", "orders", "order_count");
    pairs.push({
      currentDate: String(row.date || ""),
      previousDate: String(previousRow.date || ""),
      currentSales,
      previousSales,
      currentCovers,
      previousCovers,
      currentOrders,
      previousOrders,
      currentSpend: numField(row, "averageSpend", "avg_spend") ?? dailySpend(currentSales, currentCovers),
      previousSpend: numField(previousRow, "averageSpend", "avg_spend") ?? dailySpend(previousSales, previousCovers),
    });
  }
  return pairs;
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

  const matchedPairs = pairDailyBreakdownsByOffset(current, previous);

  if (!needsMatch) {
    return {
      mode: "full",
      likeForLike: true,
      current,
      previous,
      matchedPairs,
      matchedDayCount: matchedPairs.length || currentDays,
      ...avgPair,
    };
  }

  if (!matchedPairs.length) {
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
        matchedPairs: [],
        ...avgPair,
      };
    }
    return {
      mode: "unavailable",
      reason: "no_matched_days",
      likeForLike: false,
      isPartial: true,
      matchedPairs: [],
      ...avgPair,
    };
  }

  const matchedCurrent = matchedPairs.map((p) => ({
    date: p.currentDate,
    totalSales: p.currentSales,
    totalGuests: p.currentCovers,
    totalOrders: p.currentOrders,
    averageSpend: p.currentSpend,
  }));
  const matchedPrevious = matchedPairs.map((p) => ({
    date: p.previousDate,
    totalSales: p.previousSales,
    totalGuests: p.previousCovers,
    totalOrders: p.previousOrders,
    averageSpend: p.previousSpend,
  }));

  return {
    mode: "matched",
    likeForLike: true,
    isPartial: true,
    matchedDayCount: matchedPairs.length,
    matchedPairs,
    currentMatched: aggregateMatchedDailyRows(matchedCurrent),
    previousMatched: aggregateMatchedDailyRows(matchedPrevious),
    ...avgPair,
  };
}
