/**
 * Ask NAC menu metrics — Edge path with Phase D hybrid MTD (parity with client fetchAskNacMenuMetrics).
 */

import {
  applyHybridMetricsToPayload,
  isMonthRangeHours,
  mergeMonthToDateHybrid,
  MONTH_HOURS,
} from "./mtdHybridMerge.ts";
import { resolveCanonicalMenuSessions } from "./canonicalSessions.ts";
import { getBusinessDayKey } from "./businessDay.ts";
import { collectAskNacMetricWarnings, normalizeMtdDiagnostics } from "./mtdDiagnostics.ts";

function normalizeRpcRow(data: unknown): Record<string, unknown> | null {
  if (data == null) return null;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  return data as Record<string, unknown>;
}

async function rpcBiDashboard(
  supabase: { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  rpcName: string,
  params: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(rpcName, params);
  if (error) throw error;
  return normalizeRpcRow(data);
}

function isEmptyPayload(payload: Record<string, unknown> | null) {
  if (!payload) return true;
  const events = Number(payload.total_events) || 0;
  const funnel = payload.funnel as Record<string, unknown> | undefined;
  const qr = Number(funnel?.qr_scans) || Number(payload.menu_qr_scans) || 0;
  return events <= 0 && qr <= 0;
}

export async function fetchAskNacMenuMetrics(
  supabase: { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  { branch = null, hours = 24 }: { branch?: string | null; hours?: number } = {},
) {
  const pHours = Number(hours) || 24;
  const pBranch = branch;
  const useRollup = pHours >= 168 || pHours === MONTH_HOURS;
  const primaryRpc = useRollup ? "get_bi_dashboard_from_rollup" : "get_bi_dashboard";

  let payload = await rpcBiDashboard(supabase, primaryRpc, {
    p_branch: pBranch,
    p_hours: pHours,
  });

  let dataSource: string = useRollup ? "rollup" : "live";
  let partial = false;
  let note: string | null = null;
  const opsWarnings: string[] = [];

  if (isMonthRangeHours(pHours) && payload && !isEmptyPayload(payload)) {
    const businessDayKey = getBusinessDayKey();
    let liveTodayPayload: Record<string, unknown> | null = null;

    try {
      liveTodayPayload = await rpcBiDashboard(supabase, "get_bi_dashboard", {
        p_branch: pBranch,
        p_hours: 24,
      });
    } catch {
      liveTodayPayload = null;
    }

    if (!liveTodayPayload || isEmptyPayload(liveTodayPayload)) {
      partial = true;
      note = "Month-to-date uses rollup only — live Today slice unavailable.";
      opsWarnings.push("Live Today RPC failed during MTD hybrid merge.");
      dataSource = "rollup";
    } else {
      const mergeResult = mergeMonthToDateHybrid({
        rollupPayload: payload,
        liveTodayPayload,
        businessDayKey,
      });
      payload = applyHybridMetricsToPayload(payload, mergeResult);
      dataSource = "hybrid";
      if (mergeResult.corrected || mergeResult.warnings.length) {
        partial = true;
        note =
          "Month-to-date combines daily rollup with live Today (hybrid). Some prior rollup days may still be syncing.";
      }
      opsWarnings.push(...mergeResult.warnings);
    }
  }

  const canon = resolveCanonicalMenuSessions(payload || {});
  const mtdHybrid = normalizeMtdDiagnostics(
    (payload?._mtdHybrid as Record<string, unknown>) || null,
    dataSource,
  );

  const rpc =
    dataSource === "hybrid"
      ? "get_bi_dashboard_from_rollup+get_bi_dashboard"
      : primaryRpc;

  return {
    menuQrScans: canon.menuQrScans,
    menuSessions: canon.menuSessions,
    qr: canon.menuQrScans,
    sessions: canon.menuSessions,
    partial,
    note,
    dataSource,
    mtdHybrid,
    rpc,
    warnings: collectAskNacMetricWarnings({
      warnings: opsWarnings,
      note,
      partial,
      mtdHybrid,
    }),
  };
}
