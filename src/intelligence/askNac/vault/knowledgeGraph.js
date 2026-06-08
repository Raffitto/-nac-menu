/**
 * Operational knowledge graph — links vault documents by branch, period, and report chain.
 */

const OPERATIONAL_CHAIN = [
  ["weekly_sales_overview", "reception_daily_report", "sales_to_reception"],
  ["weekly_sales_overview", "daily_logbook", "weekly_to_daily"],
  ["foodics_export", "reception_daily_report", "sales_to_reception"],
  ["foodics_export", "cash_up", "foodics_to_cash_up"],
  ["reception_daily_report", "daily_logbook", "reception_to_logbook"],
  ["daily_logbook", "ccm_reconciliation", "logbook_to_audit"],
  ["daily_logbook", "audit_report", "logbook_to_audit"],
  ["cash_up", "daily_logbook", "cash_up_to_logbook"],
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

function overlapDays(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function extractIssueTerms(facts = []) {
  const terms = new Set();
  facts.forEach((fact) => {
    const blob = `${fact.metricKey || ""} ${fact.metricValue || ""} ${JSON.stringify(fact.dimensions || {})}`.toLowerCase();
    ISSUE_TERMS.forEach((term) => {
      if (blob.includes(term)) terms.add(term);
    });
  });
  return [...terms];
}

function sharedTermsBetween(aTerms = [], bTerms = []) {
  const b = new Set(bTerms);
  return aTerms.filter((term) => b.has(term));
}

export function inferOperationalLinks(files = [], factsByFileId = {}) {
  const links = [];
  const activeFiles = (files || []).filter((file) => file.status !== "archived");

  for (let i = 0; i < activeFiles.length; i += 1) {
    for (let j = i + 1; j < activeFiles.length; j += 1) {
      const a = activeFiles[i];
      const b = activeFiles[j];
      const sameBranch =
        a.primary_branch_id &&
        b.primary_branch_id &&
        a.primary_branch_id === b.primary_branch_id;
      const samePeriod = overlapDays(a.period_start, a.period_end, b.period_start, b.period_end);

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

      const aTerms = extractIssueTerms(factsByFileId[a.id] || []);
      const bTerms = extractIssueTerms(factsByFileId[b.id] || []);
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
        if (!overlapDays(fromFile.period_start, fromFile.period_end, toFile.period_start, toFile.period_end)) {
          return;
        }
        links.push({
          source_file_id: fromFile.id,
          target_file_id: toFile.id,
          link_type: linkType,
          link_reason: `${fromType.replace(/_/g, " ")} linked to ${toType.replace(/_/g, " ")}`,
          confidence: 0.82,
          branch_id: fromFile.primary_branch_id,
          period_start: fromFile.period_start,
          period_end: fromFile.period_end,
          shared_terms: [],
        });
      });
    });
  }

  const logbooks = activeFiles.filter((f) => f.report_type === "daily_logbook");
  const receptionFiles = activeFiles.filter((f) => f.report_type === "reception_daily_report");
  logbooks.forEach((logbook) => {
    const facts = factsByFileId[logbook.id] || [];
    const hasReviews = facts.some((f) => String(f.metric_key || f.metricKey || "").startsWith("google_review"));
    if (!hasReviews) return;
    receptionFiles.forEach((reception) => {
      if (logbook.primary_branch_id !== reception.primary_branch_id) return;
      if (!overlapDays(logbook.period_start, logbook.period_end, reception.period_start, reception.period_end)) {
        return;
      }
      links.push({
        source_file_id: logbook.id,
        target_file_id: reception.id,
        link_type: "logbook_to_reviews",
        link_reason: "Logbook Google review counts linked to reception period",
        confidence: 0.78,
        branch_id: logbook.primary_branch_id,
        period_start: logbook.period_start,
        period_end: logbook.period_end,
        shared_terms: ["google_review"],
      });
    });
  });

  const dedup = new Map();
  links.forEach((link) => {
    const key = `${link.source_file_id}:${link.target_file_id}:${link.link_type}`;
    if (!dedup.has(key)) dedup.set(key, link);
  });
  return [...dedup.values()];
}

export async function persistDocumentLinks(supabase, links = []) {
  if (!supabase || !links.length) return { inserted: 0, error: null };
  const { error } = await supabase.from("ask_nac_document_links").upsert(links, {
    onConflict: "source_file_id,target_file_id,link_type",
  });
  return { inserted: links.length, error: error?.message || null };
}

export async function fetchDocumentLinksForFile(supabase, fileId) {
  if (!supabase || !fileId) return [];
  const { data, error } = await supabase
    .from("ask_nac_document_links")
    .select(
      "id,source_file_id,target_file_id,link_type,link_reason,confidence,branch_id,period_start,period_end,shared_terms",
    )
    .or(`source_file_id.eq.${fileId},target_file_id.eq.${fileId}`);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function rebuildKnowledgeGraphForBranch(supabase, { branchId = null, limit = 500 } = {}) {
  if (!supabase) return { links: [], error: "Supabase not configured" };

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

  const factsByFileId = {};
  (facts || []).forEach((fact) => {
    if (!factsByFileId[fact.file_id]) factsByFileId[fact.file_id] = [];
    factsByFileId[fact.file_id].push(fact);
  });

  const links = inferOperationalLinks(files || [], factsByFileId);
  const persist = await persistDocumentLinks(supabase, links);
  return { links, ...persist };
}

export function summarizeKnowledgeGraphAnswer({ links = [], files = [], repeatedIssues = [] } = {}) {
  const chain = links
    .filter((link) => link.link_type !== "same_branch_period")
    .slice(0, 6)
    .map((link) => `${link.link_reason} (${Math.round((link.confidence || 0) * 100)}% confidence)`);

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
