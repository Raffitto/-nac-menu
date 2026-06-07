/**
 * Operational knowledge graph tools for Ask NAC Edge.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { branchDisplayName } from "./askNacEdgeAnswerBuilder.ts";
import { getVaultCoverage, getVaultFacts } from "./askNacVaultTools.ts";

const OPERATIONAL_CHAIN: [string, string, string][] = [
  ["weekly_sales_overview", "reception_daily_report", "sales_to_reception"],
  ["foodics_export", "reception_daily_report", "sales_to_reception"],
  ["reception_daily_report", "daily_logbook", "reception_to_logbook"],
  ["daily_logbook", "ccm_reconciliation", "logbook_to_audit"],
  ["daily_logbook", "audit_report", "logbook_to_audit"],
  ["cash_up", "daily_logbook", "operational_chain"],
];

const ISSUE_TERMS = [
  "complaint",
  "shortage",
  "waste",
  "delay",
  "no show",
  "no-show",
  "overbooking",
  "staff",
  "service",
  "quality",
  "refund",
  "void",
  "discount",
  "walkout",
  "incident",
];

function overlapDays(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function extractIssueTerms(facts: Record<string, unknown>[] = []) {
  const terms = new Set<string>();
  facts.forEach((fact) => {
    const blob = `${fact.metric_key || fact.metricKey || ""} ${fact.metric_value || fact.metricValue || ""} ${JSON.stringify(fact.dimensions || {})}`.toLowerCase();
    ISSUE_TERMS.forEach((term) => {
      if (blob.includes(term)) terms.add(term);
    });
  });
  return [...terms];
}

function sharedTermsBetween(aTerms: string[] = [], bTerms: string[] = []) {
  const b = new Set(bTerms);
  return aTerms.filter((term) => b.has(term));
}

export function inferOperationalLinks(
  files: Record<string, unknown>[] = [],
  factsByFileId: Record<string, Record<string, unknown>[]> = {},
) {
  const links: Record<string, unknown>[] = [];
  const activeFiles = (files || []).filter((file) => file.status !== "archived");

  for (let i = 0; i < activeFiles.length; i += 1) {
    for (let j = i + 1; j < activeFiles.length; j += 1) {
      const a = activeFiles[i];
      const b = activeFiles[j];
      const sameBranch =
        a.primary_branch_id &&
        b.primary_branch_id &&
        a.primary_branch_id === b.primary_branch_id;
      const samePeriod = overlapDays(
        a.period_start as string,
        a.period_end as string,
        b.period_start as string,
        b.period_end as string,
      );

      if (sameBranch && samePeriod) {
        links.push({
          source_file_id: a.id,
          target_file_id: b.id,
          link_type: "same_branch_period",
          link_reason: "Same branch and overlapping reporting period",
          confidence: 0.9,
          branch_id: a.primary_branch_id,
          period_start: a.period_start,
          period_end: a.period_end,
          shared_terms: [],
        });
      }

      const aTerms = extractIssueTerms(factsByFileId[String(a.id)] || []);
      const bTerms = extractIssueTerms(factsByFileId[String(b.id)] || []);
      const shared = sharedTermsBetween(aTerms, bTerms);
      if (shared.length >= 2 && sameBranch) {
        links.push({
          source_file_id: a.id,
          target_file_id: b.id,
          link_type: "shared_issue",
          link_reason: `Shared operational issue terms: ${shared.slice(0, 4).join(", ")}`,
          confidence: Math.min(0.95, 0.55 + shared.length * 0.1),
          branch_id: a.primary_branch_id,
          period_start: a.period_start,
          period_end: a.period_end,
          shared_terms: shared,
        });
      }
    }
  }

  for (const [fromType, toType, linkType] of OPERATIONAL_CHAIN) {
    const fromFiles = activeFiles.filter((file) => file.report_type === fromType);
    const toFiles = activeFiles.filter((file) => file.report_type === toType);
    fromFiles.forEach((fromFile) => {
      toFiles.forEach((toFile) => {
        if (fromFile.id === toFile.id) return;
        if (fromFile.primary_branch_id !== toFile.primary_branch_id) return;
        if (
          !overlapDays(
            fromFile.period_start as string,
            fromFile.period_end as string,
            toFile.period_start as string,
            toFile.period_end as string,
          )
        ) {
          return;
        }
        links.push({
          source_file_id: fromFile.id,
          target_file_id: toFile.id,
          link_type: linkType,
          link_reason: `${String(fromType).replace(/_/g, " ")} linked to ${String(toType).replace(/_/g, " ")}`,
          confidence: 0.82,
          branch_id: fromFile.primary_branch_id,
          period_start: fromFile.period_start,
          period_end: toFile.period_end,
          shared_terms: [],
        });
      });
    });
  }

  const dedup = new Map<string, Record<string, unknown>>();
  links.forEach((link) => {
    const key = `${link.source_file_id}:${link.target_file_id}:${link.link_type}`;
    if (!dedup.has(key)) dedup.set(key, link);
  });
  return [...dedup.values()];
}

async function persistDocumentLinks(supabase: SupabaseClient, links: Record<string, unknown>[] = []) {
  if (!links.length) return { inserted: 0, error: null };
  const { error } = await supabase.from("ask_nac_document_links").upsert(links, {
    onConflict: "source_file_id,target_file_id,link_type",
  });
  return { inserted: links.length, error: error?.message || null };
}

export async function rebuildKnowledgeGraphForBranch(
  supabase: SupabaseClient,
  { branchId = null, limit = 100 }: { branchId?: string | null; limit?: number } = {},
) {
  let query = supabase
    .from("ask_nac_files")
    .select("id,title,original_filename,primary_branch_id,report_type,period_start,period_end,status")
    .eq("status", "active")
    .limit(limit);
  if (branchId) query = query.eq("primary_branch_id", branchId);

  const { data: files, error: filesError } = await query;
  if (filesError) return { links: [], error: filesError.message };

  const fileIds = (files || []).map((file) => file.id);
  const { data: facts } = fileIds.length
    ? await supabase
        .from("ask_nac_structured_facts")
        .select("file_id,metric_key,metric_value,dimensions")
        .in("file_id", fileIds)
    : { data: [] };

  const factsByFileId: Record<string, Record<string, unknown>[]> = {};
  (facts || []).forEach((fact: Record<string, unknown>) => {
    const fileId = String(fact.file_id);
    if (!factsByFileId[fileId]) factsByFileId[fileId] = [];
    factsByFileId[fileId].push(fact);
  });

  const links = inferOperationalLinks(files || [], factsByFileId);
  const persist = await persistDocumentLinks(supabase, links);
  return { links, ...persist };
}

export function summarizeKnowledgeGraphAnswer({
  links = [],
  repeatedIssues = [],
}: {
  links?: Record<string, unknown>[];
  repeatedIssues?: Record<string, unknown>[];
} = {}) {
  const chain = links
    .filter((link) => link.link_type !== "same_branch_period")
    .slice(0, 6)
    .map((link) => `${link.link_reason} (${Math.round((Number(link.confidence) || 0) * 100)}% confidence)`);

  return {
    headline:
      repeatedIssues.length > 0
        ? `Repeated operational issues appear across ${repeatedIssues.length} linked report group(s).`
        : chain.length > 0
          ? "Linked operational reports show connected branch activity across the selected period."
          : "No strong cross-document operational links were found yet.",
    linkedReports: chain,
    repeatedIssues,
  };
}

function repeatedIssueGroups(links: Record<string, unknown>[] = []) {
  return links
    .filter((link) => link.link_type === "shared_issue")
    .map((link) => ({
      branch: branchDisplayName(String(link.branch_id)),
      terms: (link.shared_terms as string[]) || [],
      reason: link.link_reason,
    }));
}

export async function queryOperationalKnowledgeEdge(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const branch = (context.branchMention as string | null) || (context.filters as { branch?: string })?.branch || null;
  const vaultPeriod = (context.vaultPeriod as { startDate?: string; endDate?: string; label?: string }) || {};
  const startDate = vaultPeriod.startDate || null;
  const endDate = vaultPeriod.endDate || null;

  const graph = await rebuildKnowledgeGraphForBranch(supabase, { branchId: branch }).catch(() => ({
    links: [] as Record<string, unknown>[],
    error: null as string | null,
  }));

  const factsResult = await getVaultFacts(supabase, {
    ...context,
    branch,
    startDate,
    endDate,
  });

  const coverageResult = await getVaultCoverage(supabase, {
    ...context,
    branch,
    startDate,
    endDate,
  });

  const repeatedIssues = repeatedIssueGroups(graph.links || []);
  const summary = summarizeKnowledgeGraphAnswer({
    links: graph.links || [],
    repeatedIssues,
  });

  return {
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network",
    periodLabel: vaultPeriod.label || (startDate && endDate ? `${startDate} – ${endDate}` : "Recent uploads"),
    summary,
    links: graph.links || [],
    facts: factsResult.facts || [],
    coverage: coverageResult.coverage || [],
    repeatedIssues,
    sources: [
      { name: "ask_nac_document_links", detail: "operational knowledge graph" },
      { name: "ask_nac_structured_facts", detail: "linked vault facts" },
    ],
    warnings: graph.error ? [graph.error] : [],
  };
}
