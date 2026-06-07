/**
 * Ask NAC menu metrics fetch — shared client path aligned with Edge Function.
 * Uses fetchBiDashboard (Phase D hybrid MTD) + canonical session resolver.
 */

import { fetchBiDashboard } from "../../../lib/intelligenceQueryApi";
import { resolveCanonicalMenuSessions } from "../../../lib/customerFacingAnalytics";
import { normalizeMtdDiagnostics, collectAskNacMetricWarnings } from "./mtdDiagnostics";

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ branch?: string|null, hours?: number }} options
 */
export async function fetchAskNacMenuMetrics(supabase, { branch = null, hours = 24 } = {}) {
  const pHours = Number(hours) || 24;
  const bi = await fetchBiDashboard(supabase, { branch, hours: pHours });
  const payload = bi?.data && typeof bi.data === "object" ? bi.data : {};
  const canon = resolveCanonicalMenuSessions(payload);
  const dataSource = payload.data_source || bi.dataSource || null;
  const mtdHybrid = normalizeMtdDiagnostics(payload._mtdHybrid, dataSource);

  const tool = {
    menuQrScans: canon.menuQrScans,
    menuSessions: canon.menuSessions,
    partial: Boolean(bi.partial || mtdHybrid.partialLive),
    note: bi.note || payload.aggregation_note || null,
    dataSource,
    mtdHybrid,
    warnings: collectAskNacMetricWarnings({
      warnings: [...(bi.opsNotes || []), ...(payload._mtdHybrid?.warnings || [])],
      note: bi.note,
      partial: bi.partial,
      mtdHybrid,
    }),
    rpc: dataSource === "hybrid"
      ? "get_bi_dashboard_from_rollup+get_bi_dashboard"
      : pHours >= 168 || pHours === 999
        ? "get_bi_dashboard_from_rollup"
        : "get_bi_dashboard",
  };

  return tool;
}
