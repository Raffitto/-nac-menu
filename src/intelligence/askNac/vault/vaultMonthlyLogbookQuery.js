/**
 * Monthly logbook structured-fact query bridge (kept separate to avoid circular imports).
 */

import {
  extractOperationalMonthPeriod,
  detectMonthlyOperationalMode,
  parseMonthlyOperationalComparePeriods,
} from "./vaultMonthlyOperationalSummaryRouting";
import { buildMonthlyLogbookExecutiveSummary } from "./vaultMonthlyLogbookSummary";
import { getVaultLogbookSummaryFacts, getVaultCoverage, attachLogbookFileTitles } from "./vaultQueryTools";

export async function fetchMonthlyLogbookOperationalReview(supabase, context = {}) {
  const question = String(context.question || "");
  const vaultPeriod = context.vaultPeriod || extractOperationalMonthPeriod(question);
  if (!vaultPeriod?.isMonth) return null;

  const mode = detectMonthlyOperationalMode(question);
  const monthCompare = context.monthlyCompare || parseMonthlyOperationalComparePeriods(question);

  const coverageResult = await getVaultCoverage(supabase, {
    ...context,
    startDate: vaultPeriod.startDate,
    endDate: vaultPeriod.endDate,
    reportType: "daily_logbook",
    slim: false,
  });

  const factsResult = await getVaultLogbookSummaryFacts(supabase, {
    ...context,
    startDate: vaultPeriod.startDate,
    endDate: vaultPeriod.endDate,
  });
  factsResult.facts = attachLogbookFileTitles(factsResult.facts, coverageResult.coverage);

  let compareSummary = null;
  if (monthCompare?.current && monthCompare?.previous) {
    const [currentFacts, previousFacts, previousCoverage] = await Promise.all([
      getVaultLogbookSummaryFacts(supabase, {
        ...context,
        startDate: monthCompare.current.startDate,
        endDate: monthCompare.current.endDate,
      }),
      getVaultLogbookSummaryFacts(supabase, {
        ...context,
        startDate: monthCompare.previous.startDate,
        endDate: monthCompare.previous.endDate,
      }),
      getVaultCoverage(supabase, {
        ...context,
        startDate: monthCompare.previous.startDate,
        endDate: monthCompare.previous.endDate,
        reportType: "daily_logbook",
        slim: false,
      }),
    ]);
    const currentFactsEnriched = attachLogbookFileTitles(currentFacts.facts, coverageResult.coverage);
    const previousFactsEnriched = attachLogbookFileTitles(previousFacts.facts, previousCoverage.coverage);
    const currentSummary = buildMonthlyLogbookExecutiveSummary({
      facts: currentFactsEnriched,
      coverage: coverageResult.coverage,
      branchLabel: factsResult.branchLabel,
      periodLabel: monthCompare.current.label,
      mode: "summary",
    });
    const previousSummary = buildMonthlyLogbookExecutiveSummary({
      facts: previousFactsEnriched,
      coverage: previousCoverage.coverage,
      branchLabel: factsResult.branchLabel,
      periodLabel: monthCompare.previous.label,
      mode: "summary",
    });
    compareSummary = [
      `${monthCompare.current.label}: ${currentSummary.logbookDays} logbook day(s), confidence ${currentSummary.confidence}.`,
      `${monthCompare.previous.label}: ${previousSummary.logbookDays} logbook day(s), confidence ${previousSummary.confidence}.`,
      "Compare guest complaints, maintenance notes, staffing/system issues, and traffic language between the two months.",
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
    sources: [{ name: "ask_nac_structured_facts", detail: "Recovered daily_logbook structured facts" }],
    searchMethod: "structured_logbook_monthly_summary",
    queryStatus: "ok",
  };
}
