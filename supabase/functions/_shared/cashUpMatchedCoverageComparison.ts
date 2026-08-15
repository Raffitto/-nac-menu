/**
 * Coverage-aware Cash Up current vs previous comparison.
 * Partial windows never headline-compare unequal day totals.
 * Matched pairs are the single comparison population for totals, breadth, and contributors.
 */

export type CanonicalMatchedPair = {
  currentDate: string;
  previousDate: string;
  currentSales: number | null;
  previousSales: number | null;
  currentCovers: number | null;
  previousCovers: number | null;
  currentOrders: number | null;
  previousOrders: number | null;
  currentSpend: number | null;
  previousSpend: number | null;
};

function calendarDayOffset(startDate: string, date: string) {
  if (!startDate || !date) return null;
  const start = new Date(`${startDate}T12:00:00`);
  const day = new Date(`${date}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(day.getTime())) return null;
  return Math.round((day.getTime() - start.getTime()) / 86400000);
}

function sumDailyField(rows: Array<Record<string, unknown>> | undefined, key: string) {
  const values = (rows || []).map((row) => row?.[key]).filter((v) => v != null && Number.isFinite(Number(v)));
  if (!values.length) return null;
  return values.reduce((sum: number, value) => sum + Number(value), 0);
}

function aggregateMatchedDailyRows(rows: Array<Record<string, unknown>> = []) {
  const totalSales = sumDailyField(rows, "totalSales");
  const totalGuests = sumDailyField(rows, "totalGuests");
  const totalOrders = sumDailyField(rows, "totalOrders");
  const totalDeliverySales = sumDailyField(rows, "totalDeliverySales");
  const totalDeliveryOrders = sumDailyField(rows, "totalDeliveryOrders");
  let averageSpend = null as number | null;
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

function dailySpend(sales: number | null, covers: number | null): number | null {
  if (sales == null || covers == null || covers <= 0) return null;
  return sales / covers;
}

function numField(row: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    const v = row[key];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Pair observed days by calendar offset from each period start — the canonical Cash Up match. */
export function pairDailyBreakdownsByOffset(
  current: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null | undefined,
): CanonicalMatchedPair[] {
  if (!current || !previous) return [];
  const currentBreakdown = (current.dailyBreakdown || []) as Array<Record<string, unknown>>;
  const previousBreakdown = (previous.dailyBreakdown || []) as Array<Record<string, unknown>>;
  const currentStart = String(current.requestedStartDate || current.startDate || "");
  const previousStart = String(previous.requestedStartDate || previous.startDate || "");
  if (!currentBreakdown.length || !previousBreakdown.length || !currentStart || !previousStart) return [];

  const previousByOffset = new Map<number, Record<string, unknown>>();
  for (const row of previousBreakdown) {
    const offset = calendarDayOffset(previousStart, String(row.date || ""));
    if (offset == null) continue;
    previousByOffset.set(offset, row);
  }

  const pairs: CanonicalMatchedPair[] = [];
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

function averageDailyMetric(total: unknown, dayCount: number) {
  if (total == null || !dayCount) return null;
  return Number(total) / Number(dayCount);
}

export function resolveExpectedDayCount(aggregation: Record<string, unknown> | null | undefined) {
  if (!aggregation) return null;
  if (aggregation.expectedDayCount) return Number(aggregation.expectedDayCount);
  const start = aggregation.requestedStartDate as string | undefined;
  const end = aggregation.requestedEndDate as string | undefined;
  if (!start || !end) return null;
  const startMs = new Date(`${start}T12:00:00`).getTime();
  const endMs = new Date(`${end}T12:00:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

export function buildMatchedCoverageComparison(current: Record<string, unknown> | null | undefined, previous: Record<string, unknown> | null | undefined) {
  if (!current || !previous) {
    return { mode: "unavailable", reason: "missing_aggregation", likeForLike: false };
  }

  const expected = resolveExpectedDayCount(current);
  const currentDays = Number(current.dayCount || 0);
  const previousDays = Number(previous.dayCount || 0);
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
    const currentBreakdown = (current.dailyBreakdown || []) as Array<Record<string, unknown>>;
    const previousBreakdown = (previous.dailyBreakdown || []) as Array<Record<string, unknown>>;
    const currentStart = current.requestedStartDate as string | undefined;
    const previousStart = previous.requestedStartDate as string | undefined;
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
