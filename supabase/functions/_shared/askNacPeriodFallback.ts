/**
 * Foodics period resolution — question parse, filter MTD, or latest batch fallback.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const DEFAULT_IMPORT_TYPE = "waiter_product_sales";

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

export type FoodicsPeriod = {
  startDate: string;
  endDate: string;
  label: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function monthBounds(year: number, monthIndex: number): FoodicsPeriod {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const startDate = `${year}-${pad2(monthIndex + 1)}-01`;
  const endDate = `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}`;
  const label = new Date(Date.UTC(year, monthIndex, 1, 12)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { startDate, endDate, label };
}

function shiftMonth(year: number, monthIndex: number, delta: number) {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
}

function parseNamedMonth(q: string, referenceDate = new Date()): FoodicsPeriod | null {
  const match = q.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (!match) return null;
  const monthIndex = MONTH_MAP[match[1]];
  let year = match[2] ? Number(match[2]) : referenceDate.getFullYear();
  if (!match[2] && monthIndex > referenceDate.getMonth()) year -= 1;
  return monthBounds(year, monthIndex);
}

export function parseFoodicsPeriodFromQuestion(question = "", referenceDate = new Date()): FoodicsPeriod | null {
  const q = String(question || "").toLowerCase();
  if (/\b(this month|month to date|month-to-date|mtd)\b/.test(q)) {
    return monthBounds(referenceDate.getFullYear(), referenceDate.getMonth());
  }
  if (/\blast month\b/.test(q)) {
    const shifted = shiftMonth(referenceDate.getFullYear(), referenceDate.getMonth(), -1);
    return monthBounds(shifted.year, shifted.monthIndex);
  }
  const named = parseNamedMonth(q, referenceDate);
  if (named) return named;
  if (/\b(last 7|7d|7 days|past week|this week)\b/.test(q)) {
    const end = referenceDate.toISOString().slice(0, 10);
    const startDate = new Date(referenceDate.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    return { startDate, endDate: end, label: "Last 7 days" };
  }
  return null;
}

export function parseFoodicsComparePeriods(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase();
  let current: FoodicsPeriod | null = null;
  if (/\b(this month|month to date|month-to-date|mtd)\b/.test(q)) {
    current = monthBounds(referenceDate.getFullYear(), referenceDate.getMonth());
  } else if (/\blast month\b/.test(q)) {
    const shifted = shiftMonth(referenceDate.getFullYear(), referenceDate.getMonth(), -1);
    current = monthBounds(shifted.year, shifted.monthIndex);
  } else {
    current = parseNamedMonth(q, referenceDate) ||
      monthBounds(referenceDate.getFullYear(), referenceDate.getMonth());
  }
  const [cy, cm] = current.startDate.split("-").map(Number);
  const shifted = shiftMonth(cy, cm - 1, -1);
  const previous = monthBounds(shifted.year, shifted.monthIndex);
  return { current, previous };
}

export function detectRankingBasis(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(by quantity|quantity|units sold|qty|rank.*quantity|quantity instead|sells most|best selling|top selling|most popular)\b/.test(q)) {
    return "quantity";
  }
  return "net_sales";
}

export function detectTopLimit(question = "", fallback = 10) {
  const q = String(question || "").toLowerCase();
  const match = q.match(/\btop\s+(\d{1,2})\b/);
  if (match) return Math.min(25, Math.max(1, Number(match[1])));
  if (/\btop ten\b/.test(q)) return 10;
  return fallback;
}

export function detectRankChangeDirection(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(entered|joined|new in|moved into)\b.*\btop\b/.test(q)) return "entered";
  if (/\b(dropped|fell|left|removed from)\b.*\btop\b/.test(q)) return "dropped";
  if (/\bentered\b/.test(q)) return "entered";
  if (/\bdropped\b/.test(q)) return "dropped";
  return "both";
}

export type PeriodFallbackResult = {
  period: FoodicsPeriod | null;
  source: "question" | "filters_mtd" | "latest_batch" | "none";
  warnings: string[];
};

export async function resolveFoodicsPeriodWithFallback(
  supabase: SupabaseClient,
  {
    question,
    filters = {},
    branch = null,
    profileHint = null,
  }: {
    question?: string;
    filters?: Record<string, unknown>;
    branch?: string | null;
    profileHint?: Record<string, unknown> | null;
  },
): Promise<PeriodFallbackResult> {
  const warnings: string[] = [];

  const fromQuestion = parseFoodicsPeriodFromQuestion(question || "");
  if (fromQuestion) {
    return { period: fromQuestion, source: "question", warnings };
  }

  const timeRangeHours = Number(filters.timeRangeHours);
  const selectedRange = String(filters.selectedRange || "");
  if (timeRangeHours === 999 || selectedRange === "month") {
    const mtd = monthBounds(new Date().getFullYear(), new Date().getMonth());
    return { period: mtd, source: "filters_mtd", warnings };
  }

  let query = supabase
    .from("foodics_import_batches")
    .select("period_start, period_end, source_file_name, branch_id, uploaded_at")
    .eq("import_type", DEFAULT_IMPORT_TYPE);

  const scopedBranch = branch ||
    (profileHint as { branchScope?: string })?.branchScope ||
    (filters.branch as string | null) ||
    null;
  if (scopedBranch) query = query.eq("branch_id", String(scopedBranch).toLowerCase());

  const { data, error } = await query.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    warnings.push(`Latest Foodics batch lookup failed: ${error.message}`);
    return { period: null, source: "none", warnings };
  }

  if (!data?.period_start || !data?.period_end) {
    warnings.push("No Foodics waiter/product sales import found for period fallback.");
    return { period: null, source: "none", warnings };
  }

  const period: FoodicsPeriod = {
    startDate: String(data.period_start),
    endDate: String(data.period_end),
    label: `${data.period_start} – ${data.period_end}`,
  };
  warnings.push(
    `Period inferred from latest Foodics import (${data.source_file_name || "batch"}).`,
  );
  return { period, source: "latest_batch", warnings };
}
