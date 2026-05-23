/**
 * Dev-only BI / command-center diagnostics (stripped in production).
 */

import { devLog } from "./devLog";
import { hourlyChartRows } from "../dashboard/utils/hourlyBucketLabels";

export function logBiIntelligenceDiagnostics(ctx = {}) {
  if (process.env.NODE_ENV !== "development") return;

  const data = ctx.biData || ctx.data;
  const parseFailures = { count: 0 };
  const hourly = hourlyChartRows(data?.by_hour || [], { parseFailures });

  const items = data?.top_items || [];
  const opens = items.map((t) => Number(t.opens) || 0);
  const impressions = items.map((t) => Number(t.impressions) || 0);

  devLog("[BI diagnostics]", {
    source: ctx.source || "unknown",
    range: ctx.selectedRange || ctx.hours,
    totals: {
      events: data?.total_events,
      sessions: data?.total_sessions,
    },
    by_event_type: data?.by_event_type,
    item_counts: {
      top_items: items.length,
      unique_opens: new Set(opens).size,
      unique_impressions: new Set(impressions).size,
      sum_opens: opens.reduce((a, b) => a + b, 0),
      sum_impressions: impressions.reduce((a, b) => a + b, 0),
    },
    category_counts: {
      top_categories: (data?.top_categories || []).length,
      category_open_events: data?.by_event_type?.category_open,
    },
    hourly: {
      buckets: hourly.length,
      parse_failures: parseFailures.count,
      sample_labels: hourly.slice(0, 5).map((r) => r.label),
    },
    command_center: ctx.commandCenter || null,
    liveFallback: ctx.liveFallback,
    partial: ctx.partial,
  });
}
