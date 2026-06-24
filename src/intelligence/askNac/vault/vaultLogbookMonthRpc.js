/**
 * Server-side monthly logbook summary via get_vault_logbook_month_summary_facts RPC.
 */

import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS } from "./vaultMonthlyLogbookSummary";
import {
  attachLogbookFileTitles,
  getVaultCoverage,
  getVaultLogbookSummaryFacts,
} from "./vaultQueryTools";

function resolveBranch(context = {}) {
  const branch = resolveRbacQueryBranch(context.profile, context.branchMention || context.filters?.branch);
  const raw = String(branch || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "brand" || raw === "network") return null;
  return branch;
}

export function mapRpcLogbookMonthBundle(row = {}) {
  const facts = (row.facts || []).map((fact) => ({
    fileId: fact.fileId,
    metricKey: fact.metricKey,
    metricValue: fact.metricValue,
    dimensions: fact.dimensions || {},
    periodStart: fact.periodStart,
    periodEnd: fact.periodEnd,
    fileTitle: fact.fileTitle || null,
    confidence: fact.confidence ?? null,
  }));

  const coverage = (row.coverage || []).map((entry) => ({
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    readinessStatus: entry.readinessStatus,
    sourceFileId: entry.sourceFileId,
    fileTitle: entry.fileTitle || null,
    factCount: entry.factCount ?? null,
  }));

  return {
    facts,
    coverage,
    coverageSummary: row.coverageSummary || {
      distinctDays: 0,
      readyDays: 0,
      partialDays: 0,
      fileCount: 0,
    },
  };
}

export async function fetchLogbookMonthSummaryViaRpc(
  supabase,
  { branch, startDate, endDate, metricKeys } = {},
) {
  const { data, error } = await supabase.rpc("get_vault_logbook_month_summary_facts", {
    p_branch_id: branch,
    p_start_date: startDate,
    p_end_date: endDate,
    p_metric_keys: metricKeys?.length ? metricKeys : null,
  });

  if (error) throw new Error(error.message);
  return mapRpcLogbookMonthBundle(data || {});
}

async function fetchLogbookMonthSummaryViaPostgrest(supabase, context, { startDate, endDate }) {
  const [coverageResult, factsResult] = await Promise.all([
    getVaultCoverage(supabase, {
      ...context,
      startDate,
      endDate,
      reportType: "daily_logbook",
      slim: false,
    }),
    getVaultLogbookSummaryFacts(supabase, {
      ...context,
      startDate,
      endDate,
    }),
  ]);

  const facts = attachLogbookFileTitles(factsResult.facts, coverageResult.coverage);

  return {
    facts,
    coverage: coverageResult.coverage,
    coverageSummary: null,
    branch: factsResult.branch,
    branchLabel: factsResult.branchLabel,
    retrievalMethod: "postgrest",
    sources: [
      ...(factsResult.sources || []),
      ...(coverageResult.sources || []),
    ],
  };
}

export async function fetchLogbookMonthBundle(supabase, context = {}, { startDate, endDate } = {}) {
  const scopedBranch = context.branch ?? resolveBranch(context);
  if (!scopedBranch || !startDate || !endDate) {
    return fetchLogbookMonthSummaryViaPostgrest(supabase, context, { startDate, endDate });
  }

  try {
    const rpcBundle = await fetchLogbookMonthSummaryViaRpc(supabase, {
      branch: scopedBranch,
      startDate,
      endDate,
      metricKeys: MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS,
    });
    const facts = attachLogbookFileTitles(rpcBundle.facts, rpcBundle.coverage);

    return {
      facts,
      coverage: rpcBundle.coverage,
      coverageSummary: rpcBundle.coverageSummary,
      branch: scopedBranch,
      branchLabel: branchDisplayName(scopedBranch),
      retrievalMethod: "rpc",
      sources: [{ name: "get_vault_logbook_month_summary_facts", detail: "Monthly logbook facts + coverage RPC" }],
    };
  } catch {
    return fetchLogbookMonthSummaryViaPostgrest(supabase, context, { startDate, endDate });
  }
}
