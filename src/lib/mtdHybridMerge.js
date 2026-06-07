/**
 * Month-to-date hybrid merge — rollup closed days + live current business day.
 * Pure functions (unit-tested); Supabase hydration in hydrateMonthToDateHybrid.
 */

import { resolveCanonicalMenuSessions, enforceMenuFunnelIntegrity } from "./customerFacingAnalytics";
import { getBusinessDayKey } from "../dashboard/utils/businessDay";
import { MONTH_HOURS } from "../dashboard/utils/rangeState";

export function isMonthRangeHours(hours) {
  return Number(hours) === MONTH_HOURS || Number(hours) === 720;
}

/** Canonical menu QR / session counts from a BI payload. */
export function extractCanonicalQrMetrics(payload = {}) {
  const canon = resolveCanonicalMenuSessions(payload);
  return {
    menuQrScans: canon.menuQrScans,
    sessions: canon.menuSessions,
    allSessionIdsWithEvents: canon.allSessionIdsWithEvents || 0,
  };
}

/**
 * Rollup's attributed count for the current business day (may be stale).
 * Prefers today_qr_sessions, then daily by_hour bucket for business day key.
 */
export function extractRollupTodayQrPortion(payload = {}, businessDayKey = getBusinessDayKey()) {
  const todayField = Number(payload?.today_qr_sessions);
  if (Number.isFinite(todayField) && todayField > 0) {
    return todayField;
  }

  const funnelToday = Number(payload?.funnel?.today_qr);
  if (funnelToday > 0) return funnelToday;

  const rows = Array.isArray(payload?.by_hour) ? payload.by_hour : [];
  const match = rows.find((row) => {
    const key = String(row?.business_day_key ?? row?.hour ?? row?.day_key ?? "");
    return key === businessDayKey;
  });
  return Number(match?.count) || 0;
}

/**
 * Merge rollup MTD with live today without double-counting the current business day.
 *
 * @returns {{ hybridMenuQr, hybridSessions, closedDaysQr, rollupMenuQr, rollupTodayPortion, liveTodayMenuQr, warnings, includesCurrentBusinessDay, corrected }}
 */
export function mergeMonthToDateHybrid({
  rollupPayload = {},
  liveTodayPayload = {},
  businessDayKey = getBusinessDayKey(),
} = {}) {
  const warnings = [];
  const rollup = extractCanonicalQrMetrics(rollupPayload);
  const liveToday = extractCanonicalQrMetrics(liveTodayPayload);
  const rollupTodayPortion = extractRollupTodayQrPortion(rollupPayload, businessDayKey);

  let closedDaysQr = Math.max(0, rollup.menuQrScans - rollupTodayPortion);
  let hybridMenuQr;

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

/** Apply hybrid counts onto rollup payload (canonical funnel + diagnostics). */
export function applyHybridMetricsToPayload(rollupPayload, mergeResult) {
  if (!rollupPayload || !mergeResult) return rollupPayload;

  const funnel = enforceMenuFunnelIntegrity({
    ...(rollupPayload.funnel && typeof rollupPayload.funnel === "object" ? rollupPayload.funnel : {}),
    qr_scans: mergeResult.hybridMenuQr,
    total_sessions: mergeResult.hybridSessions,
  });

  return {
    ...rollupPayload,
    total_sessions: mergeResult.hybridSessions,
    menu_qr_scans: mergeResult.hybridMenuQr,
    funnel,
    _sessionFunnel: funnel,
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

/**
 * Fetch live Today RPC and merge into month rollup payload.
 * @param {Function} fetchTodayPayload async () => payload | null
 */
export async function hydrateMonthToDateHybrid(rollupPayload, fetchTodayPayload, options = {}) {
  if (!rollupPayload) return null;

  const businessDayKey = options.businessDayKey || getBusinessDayKey(options.referenceDate);
  let liveTodayPayload = null;

  try {
    liveTodayPayload = await fetchTodayPayload();
  } catch {
    liveTodayPayload = null;
  }

  if (!liveTodayPayload) {
    return {
      payload: rollupPayload,
      partial: true,
      note: "Month-to-date uses rollup only — live Today slice unavailable.",
      opsNotes: ["Live Today RPC failed during MTD hybrid merge."],
      hybrid: null,
    };
  }

  const mergeResult = mergeMonthToDateHybrid({
    rollupPayload,
    liveTodayPayload,
    businessDayKey,
  });

  const payload = applyHybridMetricsToPayload(rollupPayload, mergeResult);
  const userNote =
    mergeResult.corrected || mergeResult.warnings.length
      ? "Month-to-date combines daily rollup with live Today (hybrid). Some prior rollup days may still be syncing."
      : null;

  return {
    payload,
    partial: Boolean(userNote),
    note: userNote,
    opsNotes: mergeResult.warnings,
    hybrid: mergeResult,
  };
}

/** Guard: MTD canonical count must be ≥ live Today when Today ⊂ month window. */
export function assertMtdTodayInvariant(mtdMetrics, todayMetrics) {
  const mtd = Number(mtdMetrics?.menuQrScans) || 0;
  const today = Number(todayMetrics?.menuQrScans) || 0;
  if (today <= 0) return { ok: true, mtd, today };
  return { ok: mtd >= today, mtd, today };
}
