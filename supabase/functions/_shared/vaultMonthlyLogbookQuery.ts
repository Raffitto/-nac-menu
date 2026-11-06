/**
 * Monthly logbook structured-fact query bridge (kept separate to avoid circular imports).
 */

import {
  extractOperationalMonthPeriod,
  detectMonthlyOperationalMode,
  parseMonthlyOperationalComparePeriods,
} from "./vaultMonthlyOperationalSummaryRouting.ts";
import { buildMonthlyLogbookExecutiveSummary, buildMonthlyLogbookCompareSummary } from "./vaultMonthlyLogbookSummary.ts";
import { attachLogbookFileTitles } from "./askNacVaultTools.ts";
import { fetchLogbookMonthBundle } from "./askNacLogbookMonthRpc.ts";

function periodCacheKey(period: { startDate?: string; endDate?: string }) {
  return `${period?.startDate}:${period?.endDate}`;
}

function loadLogbookBundle(
  cache: Map<string, ReturnType<typeof fetchLogbookMonthBundle>>,
  supabase: Parameters<typeof fetchLogbookMonthBundle>[0],
  context: Record<string, unknown>,
  period: { startDate?: string; endDate?: string; label?: string },
) {
  const key = periodCacheKey(period);
  if (!cache.has(key)) {
    cache.set(
      key,
      fetchLogbookMonthBundle(supabase, context, {
        startDate: period.startDate,
        endDate: period.endDate,
      }),
    );
  }
  return cache.get(key)!;
}

export async function fetchMonthlyLogbookOperationalReview(supabase, context = {}) {
  const question = String(context.question || "");
  const vaultPeriod = (context.vaultPeriod as { startDate?: string; endDate?: string; label?: string; isMonth?: boolean } | null)?.startDate
    ? context.vaultPeriod as { startDate?: string; endDate?: string; label?: string }
    : extractOperationalMonthPeriod(question);
  if (!vaultPeriod?.startDate || !vaultPeriod?.endDate) return null;

  const mode = detectMonthlyOperationalMode(question);
  const vaultCompare = context.vaultCompare as { current?: { startDate?: string }; previous?: { startDate?: string } } | null;
  const monthCompare = context.monthlyCompare || parseMonthlyOperationalComparePeriods(question)
    || (vaultCompare?.current?.startDate && vaultCompare?.previous?.startDate ? vaultCompare : null);

  const bundleCache = new Map();
  const bundlePromises = [loadLogbookBundle(bundleCache, supabase, context, vaultPeriod)];

  if (monthCompare?.current && monthCompare?.previous) {
    bundlePromises.push(
      loadLogbookBundle(bundleCache, supabase, context, monthCompare.current),
      loadLogbookBundle(bundleCache, supabase, context, monthCompare.previous),
    );
  }

  const bundles = await Promise.all(bundlePromises);
  const periodBundle = bundles[0];
  const factsResult = {
    facts: periodBundle.facts,
    branch: periodBundle.branch,
    branchLabel: periodBundle.branchLabel,
  };
  const coverageResult = { coverage: periodBundle.coverage };

  let compareSummary = null;
  if (monthCompare?.current && monthCompare?.previous) {
    const currentBundle = bundles[1];
    const previousBundle = bundles[2];
    const currentFactsEnriched = attachLogbookFileTitles(
      currentBundle.facts as Record<string, unknown>[],
      coverageResult.coverage as Record<string, unknown>[],
    );
    const previousFactsEnriched = attachLogbookFileTitles(
      previousBundle.facts as Record<string, unknown>[],
      previousBundle.coverage as Record<string, unknown>[],
    );
    const currentSummary = buildMonthlyLogbookExecutiveSummary({
      facts: currentFactsEnriched,
      coverage: currentBundle.coverage,
      branchLabel: factsResult.branchLabel,
      periodLabel: monthCompare.current.label,
      mode: "summary",
    });
    const previousSummary = buildMonthlyLogbookExecutiveSummary({
      facts: previousFactsEnriched,
      coverage: previousBundle.coverage,
      branchLabel: factsResult.branchLabel,
      periodLabel: monthCompare.previous.label,
      mode: "summary",
    });
    compareSummary = buildMonthlyLogbookCompareSummary(currentSummary, previousSummary);
  }

  const summaryFacts = monthCompare?.current && monthCompare?.previous
    ? [
      ...attachLogbookFileTitles(bundles[1].facts as Record<string, unknown>[], bundles[1].coverage as Record<string, unknown>[]),
      ...attachLogbookFileTitles(bundles[2].facts as Record<string, unknown>[], bundles[2].coverage as Record<string, unknown>[]),
    ]
    : factsResult.facts;
  const summaryLabel = monthCompare?.current && monthCompare?.previous
    ? `${monthCompare.current.label || monthCompare.current.startDate} vs ${monthCompare.previous.label || monthCompare.previous.startDate}`
    : vaultPeriod.label;

  const monthlyLogbookSummary = buildMonthlyLogbookExecutiveSummary({
    facts: summaryFacts,
    coverage: coverageResult.coverage,
    branchLabel: factsResult.branchLabel,
    periodLabel: summaryLabel,
    mode,
    compareSummary,
  });

  const retrievalMethod = bundles.every((bundle) => bundle.retrievalMethod === "rpc")
    ? "structured_logbook_monthly_summary_rpc"
    : "structured_logbook_monthly_summary";

  return {
    structuredLogbookReview: true,
    monthlyLogbookSummary,
    periodLabel: summaryLabel,
    reviewTheme: mode === "complaints" || mode === "issues" ? "complaints" : mode === "recurring" ? "recurring" : mode,
    groupedFindings: monthlyLogbookSummary.groupedFindings,
    branch: factsResult.branch,
    branchLabel: factsResult.branchLabel,
    vaultSources: monthlyLogbookSummary.vaultSources,
    facts: summaryFacts,
    coverage: coverageResult.coverage,
    logbookDaysCovered: monthlyLogbookSummary.logbookDays,
    sources: [{
      name: "ask_nac_structured_facts",
      detail: retrievalMethod === "structured_logbook_monthly_summary_rpc"
        ? "Recovered daily_logbook narratives via get_vault_logbook_month_summary_facts"
        : "Recovered daily_logbook narratives",
    }],
    searchMethod: retrievalMethod,
    queryStatus: monthlyLogbookSummary.logbookDays ? "ok" : "insufficient_evidence",
  };
}
