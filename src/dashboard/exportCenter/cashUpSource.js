/**
 * Canonical Cash Up for Reports — same Vault facts Ask NAC uses.
 */

import { fetchCashUpRangeAggregationViaRpc } from "../../intelligence/askNac/vault/vaultCashUpRangeRpc";

const PAGE = 1000;

export function cashUpBusinessDate(fact) {
  const raw = fact?.period_end ?? fact?.periodEnd ?? fact?.period_start ?? fact?.periodStart;
  const text = String(raw || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function factsFromDailyBreakdown(days = [], branch) {
  return (days || []).flatMap((row) => {
    const date = String(row.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const base = { period_start: date, period_end: date, branch_id: branch, report_type: "cash_up" };
    const out = [];
    if (row.totalSales != null) {
      out.push({ ...base, metric_key: "total_sales", metric_value: row.totalSales });
      out.push({ ...base, metric_key: "net_sales", metric_value: row.totalSales });
    }
    if (row.totalGuests != null) {
      out.push({ ...base, metric_key: "guest_count", metric_value: row.totalGuests });
    }
    if (row.totalOrders != null) {
      out.push({ ...base, metric_key: "order_count", metric_value: row.totalOrders });
    }
    return out;
  });
}

async function fetchCashUpFactsPaged(supabase, { branch, from, to }) {
  const rows = [];
  let fromIdx = 0;
  for (let page = 0; page < 20; page += 1) {
    let query = supabase
      .from("ask_nac_structured_facts")
      .select("metric_key,metric_value,period_start,period_end,dimensions,branch_id,report_type")
      .eq("report_type", "cash_up")
      .eq("branch_id", branch)
      .lte("period_start", to)
      .gte("period_end", from)
      .is("archived_at", null)
      .order("period_end", { ascending: true })
      .range(fromIdx, fromIdx + PAGE - 1);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    fromIdx += PAGE;
  }
  return rows.filter((r) => r.branch_id === branch);
}

export function cashUpDatesFromRpc(rpcAgg) {
  return (rpcAgg?.dailyBreakdown || [])
    .map((row) => ({
      ...row,
      date: typeof row?.date === "string" ? row.date.slice(0, 10) : String(row?.date || "").slice(0, 10),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && (row.totalSales != null || row.totalGuests != null))
    .map((row) => row.date);
}

/** Lightweight coverage only — no fact-table scan. */
export async function fetchCashUpCoverage(supabase, { branch, from, to }) {
  try {
    const rpcAgg = await fetchCashUpRangeAggregationViaRpc(supabase, {
      branch,
      startDate: from,
      endDate: to,
      includeDailyBreakdown: true,
    });
    const cashUpDates = [...new Set(cashUpDatesFromRpc(rpcAgg))].sort();
    return { cashUpDates, rpcAgg, error: null };
  } catch (err) {
    return { cashUpDates: [], rpcAgg: null, error: err?.message || String(err) };
  }
}

/**
 * Load Cash Up coverage + workbook facts from Vault (RPC + structured facts).
 * Coverage callers should use fetchCashUpCoverage. This path is for XLSX download.
 */
export async function fetchCanonicalCashUpForExport(supabase, { branch, from, to }) {
  let rpcAgg = null;
  let rpcError = null;
  try {
    rpcAgg = await fetchCashUpRangeAggregationViaRpc(supabase, {
      branch,
      startDate: from,
      endDate: to,
      includeDailyBreakdown: true,
    });
  } catch (err) {
    rpcError = err?.message || String(err);
  }

  let facts = [];
  let factsError = null;
  try {
    facts = await fetchCashUpFactsPaged(supabase, { branch, from, to });
  } catch (err) {
    factsError = err?.message || String(err);
  }

  const rpcDates = cashUpDatesFromRpc(rpcAgg);
  const factDates = facts.map(cashUpBusinessDate).filter(Boolean);
  const cashUpDates = [...new Set([...rpcDates, ...factDates])].sort();

  if (!facts.length && rpcDates.length) {
    facts = factsFromDailyBreakdown(rpcAgg.dailyBreakdown, branch);
  }

  return {
    facts,
    cashUpDates,
    rpcAgg,
    error: !cashUpDates.length ? (rpcError || factsError || null) : null,
  };
}
