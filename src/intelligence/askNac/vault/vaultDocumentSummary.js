/**
 * Build executive summaries from ask_nac_document_chunks (no structured_facts).
 */

import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { tokenizeDocumentSearchQuery } from "./vaultDocumentSearchRetrieval";
import { extractDocumentSummarySubject } from "./vaultDocumentSummaryRouting";

const CHUNK_SELECT =
  "id,file_id,chunk_index,chunk_text,page_no,section_label,branch_id,department,report_type,period_start,period_end,file:ask_nac_files(id,title,original_filename,report_type,sensitivity_level)";

function resolveBranch(context) {
  return resolveRbacQueryBranch(context.profile, context.branchMention || context.filters?.branch);
}

function buildChunkExcerpt(chunkText, searchTerms, maxLen = 240) {
  const text = String(chunkText || "");
  if (!text) return "";
  const lower = text.toLowerCase();
  const terms = String(searchTerms || "").toLowerCase().split(/\s+/).filter(Boolean);
  let idx = -1;
  for (const term of terms) {
    const hit = lower.indexOf(term);
    if (hit >= 0 && (idx < 0 || hit < idx)) idx = hit;
  }
  if (idx < 0) return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
  const start = Math.max(0, idx - 80);
  const slice = text.slice(start, start + maxLen);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maxLen < text.length ? "…" : "";
  return `${prefix}${slice}${suffix}`.trim();
}

function formatChunkCitation(match) {
  const parts = [match.fileTitle || "Uploaded file"];
  if (match.periodStart) parts.push(match.periodStart);
  if (match.pageNo != null) parts.push(`p. ${match.pageNo}`);
  if (match.sectionLabel) parts.push(match.sectionLabel);
  return parts.join(" · ");
}

function mapSummaryChunkRow(row, searchTerms = "") {
  const file = row?.file || null;
  const fileTitle = file?.title || file?.original_filename || "Uploaded file";
  const chunkText = row.chunk_text || "";
  return {
    id: row.id,
    fileId: row.file_id,
    chunkIndex: row.chunk_index,
    chunkText,
    pageNo: row.page_no,
    sectionLabel: row.section_label,
    reportType: row.report_type || file?.report_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fileTitle,
    excerpt: buildChunkExcerpt(chunkText, searchTerms),
    citation: formatChunkCitation({
      fileTitle,
      periodStart: row.period_start,
      pageNo: row.page_no,
      sectionLabel: row.section_label,
    }),
  };
}

function escapeIlikePattern(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function scoreFileNameMatch(filename, tokens = []) {
  const lower = String(filename || "").toLowerCase();
  if (!lower || !tokens.length) return 0;
  let matched = 0;
  for (const token of tokens) {
    if (lower.includes(String(token).toLowerCase())) matched += 1;
  }
  return matched / tokens.length;
}

export async function resolveDocumentSummaryFiles(supabase, context = {}) {
  const docCtx = context.documentContext || {};
  if (docCtx.fileIds?.length) {
    return {
      fileIds: docCtx.fileIds,
      fileTitles: docCtx.fileTitles || [],
      source: "conversation",
    };
  }

  const subject = extractDocumentSummarySubject(context.question || "");
  const tokens = tokenizeDocumentSearchQuery(subject);
  if (!tokens.length) {
    return { fileIds: [], fileTitles: [], source: null };
  }

  const orClause = tokens
    .slice(0, 8)
    .map((token) => `original_filename.ilike.%${escapeIlikePattern(token)}%`)
    .join(",");

  let query = supabase
    .from("ask_nac_files")
    .select("id,title,original_filename,primary_branch_id,search_status,chunk_count")
    .eq("status", "active")
    .or(orClause)
    .limit(20);

  const scopedBranch = resolveBranch(context);
  if (scopedBranch) query = query.eq("primary_branch_id", scopedBranch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const ranked = (data || [])
    .map((row) => ({
      row,
      score: scoreFileNameMatch(row.original_filename || row.title, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 3).map((entry) => entry.row);
  return {
    fileIds: top.map((row) => row.id),
    fileTitles: top.map((row) => row.title || row.original_filename || "Uploaded file"),
    source: "filename_match",
  };
}

function summarizeChunkSentence(chunkText = "") {
  const text = String(chunkText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return sentence.length > 220 ? `${sentence.slice(0, 219)}…` : sentence;
}

function buildSummaryInsights(chunks = []) {
  return chunks.map((chunk) => {
    const sentence = summarizeChunkSentence(chunk.chunkText);
    const pageRef = chunk.pageNo != null ? ` (p. ${chunk.pageNo})` : "";
    const sectionRef = chunk.sectionLabel ? ` · ${chunk.sectionLabel}` : "";
    return `${chunk.fileTitle}${pageRef}${sectionRef}: ${sentence} [${chunk.citation}]`;
  });
}

export function buildDocumentSummaryAnswerContent({ chunks = [], fileTitles = [], branchLabel = "Network" }) {
  const names = [...new Set(fileTitles.length ? fileTitles : chunks.map((c) => c.fileTitle))];
  const titleLabel = names.length ? names.join(" · ") : "uploaded document";
  const sectionCount = chunks.length;
  const leadInsights = buildSummaryInsights(chunks.slice(0, 6));
  const directAnswer =
    `Executive summary of ${titleLabel} from Company Knowledge (${sectionCount} section${sectionCount === 1 ? "" : "s"}, ${branchLabel}). ` +
    `${leadInsights.slice(0, 2).join(" ")}`;

  return {
    directAnswer,
    insights: leadInsights,
    keyMetrics: chunks.slice(0, 8).map((chunk) => ({
      label: chunk.fileTitle,
      value: summarizeChunkSentence(chunk.chunkText),
      unit: chunk.pageNo != null ? `p. ${chunk.pageNo}` : chunk.sectionLabel || "",
      source: chunk.citation,
      note: chunk.sectionLabel || undefined,
    })),
    recommendations: [
      `Sources: ${[...new Set(chunks.map((c) => c.citation))].slice(0, 5).join("; ")}`,
    ],
  };
}

export async function summarizeVaultDocuments(supabase, context = {}) {
  const scopedBranch = resolveBranch(context);
  const resolved = await resolveDocumentSummaryFiles(supabase, context);

  if (!resolved.fileIds.length) {
    return {
      branch: scopedBranch,
      branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
      fileIds: [],
      fileTitles: [],
      chunks: [],
      matches: [],
      vaultSources: [],
      queryStatus: "no_document",
      sources: [{ name: "ask_nac_document_chunks", detail: "No uploaded document resolved for summary" }],
      warnings: [],
    };
  }

  let query = supabase
    .from("ask_nac_document_chunks")
    .select(CHUNK_SELECT)
    .in("file_id", resolved.fileIds)
    .order("chunk_index", { ascending: true });

  if (scopedBranch) query = query.eq("branch_id", scopedBranch);

  const { data, error } = await query;
  if (error) {
    return {
      branch: scopedBranch,
      branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
      fileIds: resolved.fileIds,
      fileTitles: resolved.fileTitles,
      chunks: [],
      matches: [],
      vaultSources: [],
      queryStatus: "connection_error",
      searchError: error.message,
      sources: [{ name: "ask_nac_document_chunks", detail: "Chunk load failed" }],
      warnings: [],
    };
  }

  const chunks = (data || []).map((row) => mapSummaryChunkRow(row, resolved.fileTitles.join(" ")));
  const vaultSources = [...new Map(chunks.map((c) => [c.fileId, {
    fileId: c.fileId,
    title: c.fileTitle,
    reportType: c.reportType,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
  }])).values()];

  return {
    branch: scopedBranch,
    branchLabel: scopedBranch ? branchDisplayName(scopedBranch) : "Network",
    fileIds: resolved.fileIds,
    fileTitles: resolved.fileTitles,
    chunks,
    matches: chunks,
    vaultSources,
    resolveSource: resolved.source,
    queryStatus: chunks.length ? "ok" : "no_chunks",
    sources: [{ name: "ask_nac_document_chunks", detail: "Uploaded document chunks (RLS-filtered)" }],
    warnings: [],
  };
}
