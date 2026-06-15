/**
 * Document chunk retrieval — FTS first, ILIKE + term-overlap fallback.
 */

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

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "with",
  "is", "are", "was", "were", "be", "been", "it", "this", "that", "these", "those",
  "what", "which", "who", "how", "when", "where", "about", "any", "all", "our", "their",
  "mentions", "mention", "find", "search", "show", "summarize", "summary", "uploaded",
  "document", "documents", "report", "reports", "file", "files", "vault", "knowledge",
]);

/** Expand operational query tokens for logbook-style text (lightweight, not embeddings). */
const TOKEN_ALIASES = Object.freeze({
  complaint: ["complaint", "complaints", "feedback", "issue", "issues"],
  complaints: ["complaint", "complaints", "feedback", "issue", "issues"],
  guest: ["guest", "guests", "table", "cover", "covers", "walkin", "walkins"],
  service: ["service", "feedback", "slow", "wait", "waiting"],
  quality: ["quality", "average", "food", "price"],
  issue: ["issue", "issues", "problem", "feedback", "complaint"],
  issues: ["issue", "issues", "problem", "feedback", "complaint"],
  dinner: ["dinner", "lunch", "shift", "operation"],
  operation: ["operation", "operations", "shift", "service"],
});

export function escapeIlikePattern(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function tokenizeDocumentSearchQuery(searchTerms = "") {
  const raw = String(searchTerms || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const expanded = new Set();
  for (const token of raw) {
    expanded.add(token);
    const aliases = TOKEN_ALIASES[token];
    if (aliases) {
      for (const alias of aliases) expanded.add(alias);
    }
  }
  return [...expanded];
}

export function scoreChunkTermOverlap(chunkText, tokens = []) {
  const text = String(chunkText || "").toLowerCase();
  if (!text || !tokens.length) return 0;
  let matched = 0;
  for (const token of tokens) {
    if (text.includes(String(token).toLowerCase())) matched += 1;
  }
  return matched / tokens.length;
}

export function rankChunksByTermOverlap(rows = [], tokens = [], searchTerms = "") {
  return [...rows]
    .map((row) => ({
      row,
      score: scoreChunkTermOverlap(row.chunk_text, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.row.chunk_index ?? 0) - (b.row.chunk_index ?? 0);
    })
    .slice(0, 20)
    .map((entry) => entry.row);
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

export async function runFtsChunkSearch(supabase, { select, searchTerms, scopedBranch, limit = 20 }) {
  let query = supabase
    .from("ask_nac_document_chunks")
    .select(select)
    .textSearch("search_vector", searchTerms, { type: "websearch", config: "english" })
    .limit(limit);

  if (scopedBranch) query = query.eq("branch_id", scopedBranch);

  const { data, error } = await query;
  return { data: data || [], error };
}

export async function runFallbackChunkSearch(supabase, { select, tokens, scopedBranch, limit = 100 }) {
  const patterns = tokenizeDocumentSearchQuery(tokens.join(" "));
  if (!patterns.length) return { data: [], error: null };

  const orClause = patterns
    .slice(0, 12)
    .map((token) => `chunk_text.ilike.%${escapeIlikePattern(token)}%`)
    .join(",");

  let query = supabase.from("ask_nac_document_chunks").select(select).or(orClause).limit(limit);
  if (scopedBranch) query = query.eq("branch_id", scopedBranch);

  const { data, error } = await query;
  return { data: data || [], error };
}

export async function searchVaultDocumentChunks(supabase, {
  select,
  searchTerms,
  scopedBranch = null,
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

  const fts = await runFtsChunkSearch(supabase, { select, searchTerms, scopedBranch });
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

  if (fts.data.length) {
    return {
      searchTerms,
      matches: fts.data.map((row) => mapRow(row, searchTerms)),
      searchMethod: "fts",
      queryStatus: DOCUMENT_SEARCH_STATUS.OK,
      searchError: null,
      warnings: [],
    };
  }

  const tokens = tokenizeDocumentSearchQuery(searchTerms);
  const fallback = await runFallbackChunkSearch(supabase, { select, tokens, scopedBranch });
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

  const ranked = rankChunksByTermOverlap(fallback.data, tokens, searchTerms);
  if (!ranked.length) {
    return {
      searchTerms,
      matches: [],
      searchMethod: "fallback",
      queryStatus: DOCUMENT_SEARCH_STATUS.NO_MATCH,
      searchError: null,
      warnings: [],
    };
  }

  return {
    searchTerms,
    matches: ranked.map((row) => mapRow(row, searchTerms)),
    searchMethod: "fallback",
    queryStatus: DOCUMENT_SEARCH_STATUS.OK,
    searchError: null,
    warnings: [],
  };
}
