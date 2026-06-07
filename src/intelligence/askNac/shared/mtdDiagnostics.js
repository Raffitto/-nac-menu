/**
 * Normalized MTD / data-source diagnostics for Ask NAC (client + Edge parity).
 */

/** @typedef {'live'|'rollup'|'hybrid'} AskNacMetricSource */

/**
 * @param {object|null} mtdHybrid payload._mtdHybrid from Phase D merge
 * @param {string|null} dataSource fetchBiDashboard data_source
 */
export function normalizeMtdDiagnostics(mtdHybrid, dataSource = null) {
  if (mtdHybrid && typeof mtdHybrid === "object") {
    return {
      source: mtdHybrid.source === "hybrid" ? "hybrid" : mtdHybrid.source || "hybrid",
      includesCurrentBusinessDay: Boolean(mtdHybrid.includesCurrentBusinessDay),
      partialLive: Boolean(mtdHybrid.partialLive ?? mtdHybrid.corrected),
      warnings: Array.isArray(mtdHybrid.warnings) ? [...mtdHybrid.warnings] : [],
      rollupMenuQr: mtdHybrid.rollupMenuQr ?? null,
      liveTodayMenuQr: mtdHybrid.liveTodayMenuQr ?? null,
      hybridMenuQr: mtdHybrid.hybridMenuQr ?? null,
      businessDayKey: mtdHybrid.businessDayKey ?? null,
    };
  }

  const src =
    dataSource === "hybrid"
      ? "hybrid"
      : dataSource === "rollup" || dataSource === "client_fallback"
        ? "rollup"
        : "live";

  return {
    source: src,
    includesCurrentBusinessDay: src === "live",
    partialLive: false,
    warnings: [],
    rollupMenuQr: null,
    liveTodayMenuQr: null,
    hybridMenuQr: null,
    businessDayKey: null,
  };
}

/** Merge tool warnings + rollup-only MTD note — never hide partial hybrid state. */
export function collectAskNacMetricWarnings(tool = {}) {
  const warnings = [...(tool.warnings || [])];
  const diag = tool.mtdHybrid;

  if (tool.note && !warnings.includes(tool.note)) {
    warnings.push(tool.note);
  }

  if (diag?.partialLive && diag.source === "hybrid") {
    const hybridNote =
      "Month-to-date combines daily rollup with live Today (hybrid). Some prior rollup days may still be syncing.";
    if (!warnings.some((w) => w.includes("hybrid"))) {
      warnings.push(hybridNote);
    }
  }

  if (tool.partial && diag?.source === "rollup" && !diag.includesCurrentBusinessDay) {
    const rollupOnly =
      "Month-to-date uses rollup only — live Today slice unavailable.";
    if (!warnings.some((w) => w.includes("rollup only"))) {
      warnings.push(rollupOnly);
    }
  }

  return [...new Set(warnings.filter(Boolean))];
}
