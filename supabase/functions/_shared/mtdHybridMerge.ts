/**
 * MTD hybrid merge — keep in sync with src/lib/mtdHybridMerge.js
 */

import { getBusinessDayKey } from "./businessDay.ts";
import { resolveCanonicalMenuSessions } from "./canonicalSessions.ts";

export const MONTH_HOURS = 999;

export function isMonthRangeHours(hours: number) {
  return Number(hours) === MONTH_HOURS || Number(hours) === 720;
}

export function extractCanonicalQrMetrics(payload: Record<string, unknown> = {}) {
  const canon = resolveCanonicalMenuSessions(payload);
  return {
    menuQrScans: canon.menuQrScans,
    sessions: canon.menuSessions,
  };
}

export function extractRollupTodayQrPortion(
  payload: Record<string, unknown> = {},
  businessDayKey = getBusinessDayKey(),
) {
  const todayField = Number(payload?.today_qr_sessions);
  if (Number.isFinite(todayField) && todayField > 0) {
    return todayField;
  }

  const funnel = payload?.funnel as Record<string, unknown> | undefined;
  const funnelToday = Number(funnel?.today_qr);
  if (funnelToday > 0) return funnelToday;

  const rows = Array.isArray(payload?.by_hour) ? payload.by_hour : [];
  const match = rows.find((row: Record<string, unknown>) => {
    const key = String(row?.business_day_key ?? row?.hour ?? row?.day_key ?? "");
    return key === businessDayKey;
  });
  return Number((match as Record<string, unknown>)?.count) || 0;
}

export function mergeMonthToDateHybrid({
  rollupPayload = {},
  liveTodayPayload = {},
  businessDayKey = getBusinessDayKey(),
}: {
  rollupPayload?: Record<string, unknown>;
  liveTodayPayload?: Record<string, unknown>;
  businessDayKey?: string;
} = {}) {
  const warnings: string[] = [];
  const rollup = extractCanonicalQrMetrics(rollupPayload);
  const liveToday = extractCanonicalQrMetrics(liveTodayPayload);
  const rollupTodayPortion = extractRollupTodayQrPortion(rollupPayload, businessDayKey);

  const closedDaysQr = Math.max(0, rollup.menuQrScans - rollupTodayPortion);
  let hybridMenuQr: number;

  if (rollupTodayPortion <= 0) {
    hybridMenuQr = rollup.menuQrScans + liveToday.menuQrScans;
    if (liveToday.menuQrScans > 0) {
      warnings.push(
        "Month-to-date rollup had no current business-day slice — merged live Today into MTD.",
      );
    }
  } else {
    hybridMenuQr = closedDaysQr + liveToday.menuQrScans;
  }

  let corrected = false;

  if (rollup.menuQrScans > 0 && liveToday.menuQrScans > rollup.menuQrScans) {
    corrected = true;
    warnings.push(
      "Month-to-date rollup was below live Today for the same metric — applied hybrid MTD correction.",
    );
  }

  if (
    rollupTodayPortion > 0 &&
    liveToday.menuQrScans <= rollupTodayPortion &&
    rollup.menuQrScans >= liveToday.menuQrScans
  ) {
    hybridMenuQr = Math.max(rollup.menuQrScans, hybridMenuQr);
  }

  if (hybridMenuQr < liveToday.menuQrScans) {
    corrected = true;
    hybridMenuQr = liveToday.menuQrScans;
    warnings.push("Enforced MTD ≥ Today invariant for menu QR / sessions.");
  }

  hybridMenuQr = Math.max(0, Math.round(hybridMenuQr));

  return {
    hybridMenuQr,
    hybridSessions: hybridMenuQr,
    closedDaysQr,
    rollupMenuQr: rollup.menuQrScans,
    rollupTodayPortion,
    liveTodayMenuQr: liveToday.menuQrScans,
    warnings,
    includesCurrentBusinessDay: liveToday.menuQrScans > 0,
    corrected,
    businessDayKey,
  };
}

export function applyHybridMetricsToPayload(
  rollupPayload: Record<string, unknown>,
  mergeResult: ReturnType<typeof mergeMonthToDateHybrid>,
) {
  const funnelBase =
    rollupPayload.funnel && typeof rollupPayload.funnel === "object"
      ? { ...(rollupPayload.funnel as Record<string, unknown>) }
      : {};

  const funnel = {
    ...funnelBase,
    qr_scans: mergeResult.hybridMenuQr,
    total_sessions: mergeResult.hybridSessions,
  };

  return {
    ...rollupPayload,
    total_sessions: mergeResult.hybridSessions,
    menu_qr_scans: mergeResult.hybridMenuQr,
    funnel,
    _sessionFunnel: funnel,
    data_source: "hybrid",
    _mtdHybrid: {
      source: "hybrid",
      includesCurrentBusinessDay: mergeResult.includesCurrentBusinessDay,
      rollupMenuQr: mergeResult.rollupMenuQr,
      rollupTodayPortion: mergeResult.rollupTodayPortion,
      liveTodayMenuQr: mergeResult.liveTodayMenuQr,
      hybridMenuQr: mergeResult.hybridMenuQr,
      closedDaysQr: mergeResult.closedDaysQr,
      businessDayKey: mergeResult.businessDayKey,
      corrected: mergeResult.corrected,
      warnings: mergeResult.warnings,
      partialLive: mergeResult.corrected || mergeResult.warnings.length > 0,
    },
  };
}
