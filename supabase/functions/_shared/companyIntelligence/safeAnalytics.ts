/**
 * Safe analytics sandbox — allowlisted operations only. No arbitrary code execution.
 */

export type SafeAnalyticsOp =
  | "percent_change"
  | "daily_average"
  | "matched_day_delta"
  | "simple_trend_direction"
  | "anomaly_zscore_basic"
  | "correlation_pearson";

export type SafeAnalyticsRequest = {
  op: SafeAnalyticsOp;
  values: number[];
  baselineValues?: number[];
};

export type SafeAnalyticsResult = {
  ok: boolean;
  op: SafeAnalyticsOp;
  result: number | string | null;
  error?: string | null;
};

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pearson(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = mean(a)!;
  const mb = mean(b)!;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export function runSafeAnalytics(request: SafeAnalyticsRequest): SafeAnalyticsResult {
  const op = request.op;
  const values = (request.values || []).filter((n) => Number.isFinite(n));
  const baseline = (request.baselineValues || []).filter((n) => Number.isFinite(n));

  switch (op) {
    case "percent_change": {
      const cur = values[0];
      const base = baseline[0] ?? values[1];
      if (cur == null || base == null || base === 0) {
        return { ok: false, op, result: null, error: "insufficient_values" };
      }
      return { ok: true, op, result: ((cur - base) / Math.abs(base)) * 100 };
    }
    case "daily_average": {
      const m = mean(values);
      return m == null
        ? { ok: false, op, result: null, error: "insufficient_values" }
        : { ok: true, op, result: m };
    }
    case "matched_day_delta": {
      if (!values.length || values.length !== baseline.length) {
        return { ok: false, op, result: null, error: "length_mismatch" };
      }
      const deltas = values.map((v, i) => v - baseline[i]);
      return { ok: true, op, result: mean(deltas) };
    }
    case "simple_trend_direction": {
      if (values.length < 2) return { ok: false, op, result: null, error: "insufficient_values" };
      const first = values[0];
      const last = values[values.length - 1];
      if (last > first * 1.02) return { ok: true, op, result: "up" };
      if (last < first * 0.98) return { ok: true, op, result: "down" };
      return { ok: true, op, result: "flat" };
    }
    case "anomaly_zscore_basic": {
      if (values.length < 3) return { ok: false, op, result: null, error: "insufficient_values" };
      const m = mean(values)!;
      const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
      const sd = Math.sqrt(variance);
      if (sd === 0) return { ok: true, op, result: 0 };
      const latest = values[values.length - 1];
      return { ok: true, op, result: (latest - m) / sd };
    }
    case "correlation_pearson": {
      const r = pearson(values, baseline);
      return r == null
        ? { ok: false, op, result: null, error: "insufficient_values" }
        : { ok: true, op, result: r };
    }
    default:
      return { ok: false, op, result: null, error: "unsupported_op" };
  }
}
