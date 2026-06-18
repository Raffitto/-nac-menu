/**
 * Document chunk retrieval — FTS + ILIKE fallback, operational re-ranking.
 */

import {
  buildSearchQueryContext,
  expandSearchTokens,
  rankDocumentSearchChunks,
} from "./vaultDocumentSearchRanking";

export {
  rankChunksByTermOverlap,
  scoreChunkTermOverlap,
  tokenizeDocumentSearchQuery,
  buildOperationalSearchDirectAnswer,
  assessSearchMatchConfidence,
  isHeaderOnlyChunk,
  rankDocumentSearchChunks,
} from "./vaultDocumentSearchRanking";

export const DOCUMENT_SEARCH_MESSAGES = Object.freeze({
  NO_MATCH: "No matching information found in uploaded documents.",
  AUTH_FAILED: "You do not have access to search uploaded documents.",
  CONNECTION_FAILED: "Could not search uploaded documents — connection failed.",
});

export const DOCUMENT_SEARCH_STATUS = Object.freeze({
  OK: "ok",
  NO_MATCH: "no_match",
  AUTH_ERROR: "auth_error",
  CONNECTION_ERROR: "connection_error",
});

const MIN_RELEVANCE_SCORE = 20;

function hasMetadataFilters({ vaultPeriod, reportTypes } = {}) {
  return Boolean((vaultPeriod?.startDate && vaultPeriod?.endDate) || reportTypes?.length);
}

export function escapeIlikePattern(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function classifyDocumentSearchError(error) {
  if (!error) return DOCUMENT_SEARCH_STATUS.OK;
  const msg = String(error.message || error).toLowerCase();
  if (
    msg.includes("jwt")
    || msg.includes("permission denied")
    || msg.includes("row-level security")
    || msg.includes("not authorized")
    || msg.includes("insufficient privilege")
  ) {
    return DOCUMENT_SEARCH_STATUS.AUTH_ERROR;
  }
  return DOCUMENT_SEARCH_STATUS.CONNECTION_ERROR;
}

function mapRankedRows(ranked, searchTerms, mapRow) {
  return ranked.map(({ row, relevanceScore }) => {
    const mapped = mapRow(row, searchTerms);
    return { ...mapped, relevanceScore };
  });
}

function applyChunkMetadataFilters(query, { scopedBranch, vaultPeriod, reportTypes } = {}) {
  let next = query;
  if (scopedBranch) next = next.eq("branch_id", scopedBranch);
  if (vaultPeriod?.startDate && vaultPeriod?.endDate) {
    next = next.lte("period_start", vaultPeriod.endDate).gte("period_end", vaultPeriod.startDate);
  }
  if (reportTypes?.length) next = next.in("report_type", reportTypes);
  return next;
}

export async function runFtsChunkSearch(supabase, {
  select,
  searchTerms,
  scopedBranch,
  vaultPeriod = null,
  reportTypes = [],
  limit = 60,
}) {
  let query = supabase
    .from("ask_nac_document_chunks")
    .select(select)
    .textSearch("search_vector", searchTerms, { type: "websearch", config: "english" })
    .limit(limit);

  query = applyChunkMetadataFilters(query, { scopedBranch, vaultPeriod, reportTypes });

  const { data, error } = await query;
  return { data: data || [], error };
}

export async function runFallbackChunkSearch(supabase, {
  select,
  searchTerms,
  scopedBranch,
  vaultPeriod = null,
  reportTypes = [],
  limit = 120,
}) {
  const tokens = expandSearchTokens(searchTerms);
  if (!tokens.length) return { data: [], error: null };

  const orClause = tokens
    .slice(0, 16)
    .map((token) => `chunk_text.ilike.%${escapeIlikePattern(token)}%`)
    .join(",");

  let query = supabase.from("ask_nac_document_chunks").select(select).or(orClause).limit(limit);
  query = applyChunkMetadataFilters(query, { scopedBranch, vaultPeriod, reportTypes });

  const { data, error } = await query;
  return { data: data || [], error };
}

function pickRankedMatches(rows, searchTerms, mapRow, rankingOptions = {}) {
  const ranked = rankDocumentSearchChunks(rows, searchTerms, rankingOptions);
  const strong = ranked.filter((entry) => entry.relevanceScore >= MIN_RELEVANCE_SCORE);
  const chosen = (strong.length ? strong : ranked).slice(0, 20);
  if (!chosen.length) return [];
  return mapRankedRows(chosen, searchTerms, mapRow);
}

export async function searchVaultDocumentChunks(supabase, {
  select,
  searchTerms,
  scopedBranch = null,
  vaultPeriod = null,
  reportTypes = [],
  preferRecent = false,
  mapRow,
}) {
  if (!searchTerms || searchTerms.length < 2) {
    return {
      searchTerms,
      matches: [],
      searchMethod: null,
      queryStatus: DOCUMENT_SEARCH_STATUS.NO_MATCH,
      searchError: null,
      warnings: ["Could not extract search terms from the question."],
    };
  }

  const rankingOptions = { scopedBranch, vaultPeriod, reportTypes, preferRecent };

  const fts = await runFtsChunkSearch(supabase, {
    select,
    searchTerms,
    scopedBranch,
    vaultPeriod,
    reportTypes,
  });
  if (fts.error) {
    return {
      searchTerms,
      matches: [],
      searchMethod: null,
      queryStatus: classifyDocumentSearchError(fts.error),
      searchError: fts.error.message,
      warnings: [],
    };
  }

  let candidateRows = [...(fts.data || [])];
  let searchMethod = "fts";

  let rankedMatches = pickRankedMatches(candidateRows, searchTerms, mapRow, rankingOptions);
  const topScore = rankedMatches[0]?.relevanceScore ?? 0;

  if (!rankedMatches.length || topScore < MIN_RELEVANCE_SCORE) {
    const fallback = await runFallbackChunkSearch(supabase, {
      select,
      searchTerms,
      scopedBranch,
      vaultPeriod,
      reportTypes,
    });
    if (fallback.error) {
      return {
        searchTerms,
        matches: [],
        searchMethod: null,
        queryStatus: classifyDocumentSearchError(fallback.error),
        searchError: fallback.error.message,
        warnings: [],
      };
    }

    const merged = new Map();
    for (const row of [...candidateRows, ...(fallback.data || [])]) {
      merged.set(row.id || `${row.file_id}-${row.chunk_index}`, row);
    }
    candidateRows = [...merged.values()];
    rankedMatches = pickRankedMatches(candidateRows, searchTerms, mapRow, rankingOptions);
    searchMethod = rankedMatches.length ? "fallback" : fts.data?.length ? "fts" : "fallback";
  }

  if (!rankedMatches.length && hasMetadataFilters({ vaultPeriod, reportTypes })) {
    const relaxedFts = await runFtsChunkSearch(supabase, { select, searchTerms, scopedBranch });
    if (relaxedFts.error) {
      return {
        searchTerms,
        matches: [],
        searchMethod: null,
        queryStatus: classifyDocumentSearchError(relaxedFts.error),
        searchError: relaxedFts.error.message,
        warnings: [],
      };
    }

    const relaxedFallback = await runFallbackChunkSearch(supabase, { select, searchTerms, scopedBranch });
    if (relaxedFallback.error) {
      return {
        searchTerms,
        matches: [],
        searchMethod: null,
        queryStatus: classifyDocumentSearchError(relaxedFallback.error),
        searchError: relaxedFallback.error.message,
        warnings: [],
      };
    }

    const merged = new Map();
    for (const row of [...(relaxedFts.data || []), ...(relaxedFallback.data || [])]) {
      merged.set(row.id || `${row.file_id}-${row.chunk_index}`, row);
    }
    candidateRows = [...merged.values()];
    rankedMatches = pickRankedMatches(candidateRows, searchTerms, mapRow, rankingOptions);
    searchMethod = rankedMatches.length ? "fallback_relaxed_metadata" : searchMethod;
  }

  if (!rankedMatches.length) {
    return {
      searchTerms,
      matches: [],
      searchMethod: candidateRows.length ? searchMethod : null,
      queryStatus: DOCUMENT_SEARCH_STATUS.NO_MATCH,
      searchError: null,
      warnings: [],
    };
  }

  return {
    searchTerms,
    matches: rankedMatches,
    searchMethod,
    queryStatus: DOCUMENT_SEARCH_STATUS.OK,
    searchError: null,
    warnings: [],
    queryContext: buildSearchQueryContext(searchTerms),
  };
}
