/**
 * Monthly logbook structured-fact query bridge (kept separate to avoid circular imports).
 */

import {
  extractOperationalMonthPeriod,
  detectMonthlyOperationalMode,
  parseMonthlyOperationalComparePeriods,
} from "./vaultMonthlyOperationalSummaryRouting";
import { buildMonthlyLogbookExecutiveSummary, buildOperationalEvidenceLedger, compareOperationalEvidenceWindows } from "./vaultMonthlyLogbookSummary";
import { attachLogbookFileTitles } from "./vaultQueryTools";
import { fetchLogbookMonthBundle } from "./vaultLogbookMonthRpc";

function periodCacheKey(period) {
  return `${period?.startDate}:${period?.endDate}`;
}

function loadLogbookBundle(cache, supabase, context, period) {
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
  return cache.get(key);
}

export async function fetchMonthlyLogbookOperationalReview(supabase, context = {}) {
  const question = String(context.question || "");
  const vaultPeriod = context.vaultPeriod?.startDate && context.vaultPeriod?.endDate
    ? context.vaultPeriod
    : extractOperationalMonthPeriod(question);
  if (!vaultPeriod?.startDate || !vaultPeriod?.endDate || vaultPeriod?.isSingleDay) return null;

  const mode = detectMonthlyOperationalMode(question);
  const monthCompare = context.monthlyCompare || parseMonthlyOperationalComparePeriods(question)
    || (context.vaultCompare?.current?.startDate && context.vaultCompare?.previous?.startDate
      ? context.vaultCompare : null);

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
      currentBundle.facts,
      currentBundle.coverage,
    );
    const previousFactsEnriched = attachLogbookFileTitles(
      previousBundle.facts,
      previousBundle.coverage,
    );
    const evidence = buildOperationalEvidenceLedger([...currentFactsEnriched, ...previousFactsEnriched]);
    const comparison = compareOperationalEvidenceWindows(evidence, monthCompare.previous, monthCompare.current);
    compareSummary = [
      `${comparison.first.label}: ${comparison.first.daysCovered} day(s) with narrative evidence.`,
      `${comparison.second.label}: ${comparison.second.daysCovered} day(s) with narrative evidence.`,
      ...comparison.changes.map((change) =>
        `${change.label}: ${change.firstDays} → ${change.secondDays} day(s) (${change.deltaDays >= 0 ? "+" : ""}${change.deltaDays}).`
      ),
      "Counts are distinct days mentioning each theme, not incident totals. Missing narrative coverage can affect comparisons.",
    ];
  }

  const monthlyLogbookSummary = buildMonthlyLogbookExecutiveSummary({
    facts: factsResult.facts,
    coverage: coverageResult.coverage,
    branchLabel: factsResult.branchLabel,
    periodLabel: vaultPeriod.label,
    mode,
    compareSummary,
  });

  if (!monthlyLogbookSummary.logbookDays) return null;

  const retrievalMethod = bundles.every((bundle) => bundle.retrievalMethod === "rpc")
    ? "structured_logbook_monthly_summary_rpc"
    : "structured_logbook_monthly_summary";

  return {
    structuredLogbookReview: true,
    monthlyLogbookSummary,
    periodLabel: vaultPeriod.label,
    reviewTheme: mode === "recurring" ? "recurring" : mode === "issues" ? "complaints" : "general",
    groupedFindings: monthlyLogbookSummary.groupedFindings,
    branch: factsResult.branch,
    branchLabel: factsResult.branchLabel,
    vaultSources: monthlyLogbookSummary.vaultSources,
    facts: factsResult.facts,
    coverage: coverageResult.coverage,
    logbookDaysCovered: monthlyLogbookSummary.logbookDays,
    sources: periodBundle.sources || [{ name: "ask_nac_structured_facts", detail: "Recovered daily_logbook structured facts" }],
    searchMethod: retrievalMethod,
    queryStatus: "ok",
  };
}
