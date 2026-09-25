/**
 * Ask NAC menu metrics — Edge path aligned with client fetchBiDashboard / rollup fabric.
 * Never calls raw get_bi_dashboard (8s menu_events statement timeout).
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
  // Same fabric as interactive Overview / Intelligence — rollup only.
  const primaryRpc = "get_bi_dashboard_from_rollup";

  let payload = await rpcBiDashboard(supabase, primaryRpc, {
    p_branch: pBranch,
    p_hours: pHours,
  });

  let dataSource = "rollup";
  let partial = Boolean(payload?.partial_mode);
  let note: string | null = (payload?.aggregation_note as string) || null;
  const opsWarnings: string[] = [];

  // MTD: combine month rollup with Today rollup slice (no raw ledger scan).
  if (isMonthRangeHours(pHours) && payload && !isEmptyPayload(payload)) {
    const businessDayKey = getBusinessDayKey();
    let todayRollup: Record<string, unknown> | null = null;

    try {
      todayRollup = await rpcBiDashboard(supabase, "get_bi_dashboard_from_rollup", {
        p_branch: pBranch,
        p_hours: 24,
      });
    } catch {
      todayRollup = null;
    }

    if (!todayRollup || isEmptyPayload(todayRollup)) {
      partial = true;
      note = "Month-to-date uses rollup only — Today rollup slice unavailable.";
      opsWarnings.push("Today rollup slice failed during MTD hybrid merge.");
      dataSource = "rollup";
    } else {
      const mergeResult = mergeMonthToDateHybrid({
        rollupPayload: payload,
        liveTodayPayload: todayRollup,
        businessDayKey,
      });
      payload = applyHybridMetricsToPayload(payload, mergeResult);
      dataSource = "hybrid";
      if (mergeResult.corrected || mergeResult.warnings.length) {
        partial = true;
        note =
          "Month-to-date combines daily rollup with Today rollup slice (hybrid). Some prior days may still be syncing.";
      }
      opsWarnings.push(...mergeResult.warnings);
    }
  } else if (isEmptyPayload(payload)) {
    partial = true;
    note = note || "No menu activity in rollup for this period.";
  }

  const canon = resolveCanonicalMenuSessions(payload || {});
  const mtdHybrid = normalizeMtdDiagnostics(
    (payload?._mtdHybrid as Record<string, unknown>) || null,
    dataSource,
  );

  const rpc =
    dataSource === "hybrid"
      ? "get_bi_dashboard_from_rollup+get_bi_dashboard_from_rollup"
      : primaryRpc;

  void MONTH_HOURS;

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
      note: !isMonthRangeHours(pHours) && note && /month-to-date/i.test(note) ? null : note,
      partial,
      isMonthRange: isMonthRangeHours(pHours),
      mtdHybrid,
    }),
  };
}
