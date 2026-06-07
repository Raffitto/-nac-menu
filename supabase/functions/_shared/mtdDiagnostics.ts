/** MTD diagnostics — keep in sync with src/intelligence/askNac/shared/mtdDiagnostics.js */

export type AskNacMetricSource = "live" | "rollup" | "hybrid";

export function normalizeMtdDiagnostics(
  mtdHybrid: Record<string, unknown> | null | undefined,
  dataSource: string | null = null,
) {
  if (mtdHybrid && typeof mtdHybrid === "object") {
    return {
      source: (mtdHybrid.source === "hybrid" ? "hybrid" : mtdHybrid.source || "hybrid") as AskNacMetricSource,
      includesCurrentBusinessDay: Boolean(mtdHybrid.includesCurrentBusinessDay),
      partialLive: Boolean(mtdHybrid.partialLive ?? mtdHybrid.corrected),
      warnings: Array.isArray(mtdHybrid.warnings) ? [...(mtdHybrid.warnings as string[])] : [],
      rollupMenuQr: mtdHybrid.rollupMenuQr ?? null,
      liveTodayMenuQr: mtdHybrid.liveTodayMenuQr ?? null,
      hybridMenuQr: mtdHybrid.hybridMenuQr ?? null,
      businessDayKey: mtdHybrid.businessDayKey ?? null,
    };
  }

  const src: AskNacMetricSource =
    dataSource === "hybrid"
      ? "hybrid"
      : dataSource === "rollup" || dataSource === "client_fallback"
        ? "rollup"
        : "live";

  return {
    source: src,
    includesCurrentBusinessDay: src === "live",
    partialLive: false,
    warnings: [] as string[],
    rollupMenuQr: null,
    liveTodayMenuQr: null,
    hybridMenuQr: null,
    businessDayKey: null,
  };
}

export function collectAskNacMetricWarnings(tool: {
  warnings?: string[];
  note?: string | null;
  partial?: boolean;
  mtdHybrid?: ReturnType<typeof normalizeMtdDiagnostics>;
}) {
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
    const rollupOnly = "Month-to-date uses rollup only — live Today slice unavailable.";
    if (!warnings.some((w) => w.includes("rollup only"))) {
      warnings.push(rollupOnly);
    }
  }

  return [...new Set(warnings.filter(Boolean))];
}
