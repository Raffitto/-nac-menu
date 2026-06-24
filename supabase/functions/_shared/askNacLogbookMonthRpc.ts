/**
 * Server-side monthly logbook summary via get_vault_logbook_month_summary_facts RPC (Edge).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacFoodicsTools.ts";
import { MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS } from "./vaultMonthlyLogbookSummary.ts";
import {
  attachLogbookFileTitles,
  getVaultCoverage,
  getVaultLogbookSummaryFacts,
} from "./askNacVaultTools.ts";

function normalizeVaultBranch(value: unknown): string | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "brand" || raw === "network") return null;
  if (raw.includes("khobar")) return "khobar";
  if (raw.includes("riyadh")) return "riyadh";
  if (raw.includes("jeddah") || raw.includes("jedda")) return "jeddah";
  return raw;
}

function resolveBranch(context: Record<string, unknown> = {}): string | null {
  const branchMention = context.branchMention as string | null;
  const filters = context.filters as { branch?: string } | undefined;
  const profile = context.profile as { branchScope?: string; allBranches?: boolean } | undefined;
  if (profile?.branchScope && !profile.allBranches) return normalizeVaultBranch(profile.branchScope);
  return normalizeVaultBranch(branchMention || filters?.branch || (context.branch as string | null) || null);
}

export function mapRpcLogbookMonthBundle(row: Record<string, unknown> = {}) {
  const facts = ((row.facts as Record<string, unknown>[]) || []).map((fact) => ({
    fileId: fact.fileId,
    metricKey: fact.metricKey,
    metricValue: fact.metricValue,
    dimensions: (fact.dimensions as Record<string, unknown>) || {},
    periodStart: fact.periodStart,
    periodEnd: fact.periodEnd,
    fileTitle: (fact.fileTitle as string) || null,
    confidence: fact.confidence ?? null,
  }));

  const coverage = ((row.coverage as Record<string, unknown>[]) || []).map((entry) => ({
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    readinessStatus: entry.readinessStatus,
    sourceFileId: entry.sourceFileId,
    fileTitle: (entry.fileTitle as string) || null,
    factCount: entry.factCount ?? null,
  }));

  return {
    facts,
    coverage,
    coverageSummary: (row.coverageSummary as Record<string, unknown>) || {
      distinctDays: 0,
      readyDays: 0,
      partialDays: 0,
      fileCount: 0,
    },
  };
}

export async function fetchLogbookMonthSummaryViaRpc(
  supabase: SupabaseClient,
  {
    branch,
    startDate,
    endDate,
    metricKeys,
  }: {
    branch?: string | null;
    startDate?: string;
    endDate?: string;
    metricKeys?: string[];
  } = {},
) {
  const { data, error } = await supabase.rpc("get_vault_logbook_month_summary_facts", {
    p_branch_id: branch,
    p_start_date: startDate,
    p_end_date: endDate,
    p_metric_keys: metricKeys?.length ? metricKeys : null,
  });

  if (error) throw new Error(error.message);
  return mapRpcLogbookMonthBundle((data as Record<string, unknown>) || {});
}

async function fetchLogbookMonthSummaryViaPostgrest(
  supabase: SupabaseClient,
  context: Record<string, unknown>,
  { startDate, endDate }: { startDate?: string; endDate?: string },
) {
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

  const facts = attachLogbookFileTitles(
    factsResult.facts as Record<string, unknown>[],
    coverageResult.coverage as Record<string, unknown>[],
  );

  return {
    facts,
    coverage: coverageResult.coverage,
    coverageSummary: null,
    branch: factsResult.branch,
    branchLabel: factsResult.branchLabel,
    retrievalMethod: "postgrest",
    sources: [
      ...((factsResult.sources as Record<string, unknown>[]) || []),
      ...((coverageResult.sources as Record<string, unknown>[]) || []),
    ],
  };
}

export async function fetchLogbookMonthBundle(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
  { startDate, endDate }: { startDate?: string; endDate?: string } = {},
) {
  const scopedBranch = (context.branch as string | null) ?? resolveBranch(context);
  if (!scopedBranch || !startDate || !endDate) {
    return fetchLogbookMonthSummaryViaPostgrest(supabase, context, { startDate, endDate });
  }

  try {
    const rpcBundle = await fetchLogbookMonthSummaryViaRpc(supabase, {
      branch: scopedBranch,
      startDate,
      endDate,
      metricKeys: [...MONTHLY_LOGBOOK_SUMMARY_METRIC_KEYS],
    });
    const facts = attachLogbookFileTitles(
      rpcBundle.facts as Record<string, unknown>[],
      rpcBundle.coverage as Record<string, unknown>[],
    );

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
