/**
 * Operational knowledge queries across linked vault documents.
 */

import { getVaultFacts, getVaultCoverage } from "./vaultQueryTools";
import { rebuildKnowledgeGraphForBranch, summarizeKnowledgeGraphAnswer } from "./knowledgeGraph";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";

function repeatedIssueGroups(links = []) {
  const groups = links.filter((link) => link.link_type === "shared_issue");
  return groups.map((link) => ({
    branch: branchDisplayName(link.branch_id),
    terms: link.shared_terms || [],
    reason: link.link_reason,
  }));
}

export async function queryOperationalKnowledge(supabase, context = {}) {
  const branch = context.branchMention || context.filters?.branch || null;
  const vaultPeriod = context.vaultPeriod || {};
  const startDate = vaultPeriod.startDate || null;
  const endDate = vaultPeriod.endDate || null;

  const graph = await rebuildKnowledgeGraphForBranch(supabase, { branchId: branch }).catch(() => ({
    links: [],
    error: null,
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
