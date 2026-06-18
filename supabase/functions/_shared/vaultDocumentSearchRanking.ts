/**
 * Operational document search ranking, query expansion, and answer synthesis.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "with",
  "is", "are", "was", "were", "be", "been", "it", "this", "that", "these", "those",
  "what", "which", "who", "how", "when", "where", "about", "any", "all", "our", "their",
  "mentions", "mention", "find", "search", "show", "summarize", "summary", "uploaded",
  "document", "documents", "report", "reports", "file", "files", "vault", "knowledge",
  "nac", "company",
]);

/** Multi-word phrases → variants (order matters for extraction). */
const PHRASE_EXPANSIONS = [
  { phrase: "chicken slider", variants: ["chicken slider", "chicken sliders"] },
  { phrase: "french toast", variants: ["french toast"] },
  { phrase: "sick leave", variants: ["sick leave", "on sick leave", "sick", "absent", "illness", "ill"] },
  { phrase: "unavailable item", variants: ["unavailable", "sold out", "not available", "86"] },
  { phrase: "unavailable items", variants: ["unavailable", "sold out", "not available", "86"] },
  { phrase: "food quality", variants: ["food quality", "food was average", "quality issue", "quality issues"] },
  { phrase: "guest complaint", variants: ["guest complaint", "guest complaints", "complaint", "complaints", "complained"] },
  { phrase: "guest complaints", variants: ["guest complaint", "guest complaints", "complaint", "complaints", "complained"] },
];

const TOKEN_EXPANSIONS = {
  complaint: ["complaint", "complaints", "complain", "complained", "complaining", "feedback", "issue", "issues"],
  complaints: ["complaint", "complaints", "complain", "complained", "feedback", "issue", "issues"],
  complain: ["complaint", "complaints", "complain", "complained", "feedback"],
  complained: ["complaint", "complaints", "complain", "complained", "feedback"],
  guest: ["guest", "guests", "table", "cover", "covers", "walkin", "walkins"],
  guests: ["guest", "guests", "table", "cover", "covers"],
  quality: ["quality", "average", "taste", "burning", "cold", "undercooked"],
  issues: ["issue", "issues", "problem", "feedback", "complaint", "complaints"],
  issue: ["issue", "issues", "problem", "feedback", "complaint"],
  unavailable: ["unavailable", "sold out", "not available", "86"],
  sick: ["sick", "illness", "ill", "absent", "leave"],
  leave: ["leave", "absent", "sick", "illness"],
  slider: ["slider", "sliders"],
  sliders: ["slider", "sliders"],
  chicken: ["chicken"],
  latte: ["latte", "lattes"],
  lattes: ["latte", "lattes"],
  toast: ["toast"],
  french: ["french"],
  food: ["food", "dish", "meal"],
  average: ["average", "quality"],
  price: ["price", "expensive", "high"],
  high: ["high", "expensive", "too high"],
  lyn: ["lyn"],
  dinner: ["dinner", "shift", "service"],
  lunch: ["lunch", "shift", "service"],
  breakfast: ["breakfast", "morning"],
  service: ["service", "feedback", "slow", "wait", "waiting"],
  operation: ["operation", "operations", "shift", "service"],
};

const HEADER_ONLY_PATTERNS = [
  /^complaints?\s*$/i,
  /^guest complaints?\s*$/i,
  /^operational issues?\s*$/i,
  /^training\s*$/i,
  /^reception\s*$/i,
  /^breakfast\s*$/i,
  /^lunch\s*$/i,
  /^dinner\s*$/i,
];

const TEMPLATE_CHUNK_PATTERNS = [
  /^google review\s+(\d\s+star\s+\d+\s*)+$/i,
  /^5\s+star\s+\d+/i,
];

export function normalizeSearchText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleStemVariants(token) {
  const variants = new Set([token]);
  if (token.length > 4 && token.endsWith("s")) variants.add(token.slice(0, -1));
  if (token.length > 5 && token.endsWith("ed")) variants.add(token.slice(0, -2));
  if (token.length > 5 && token.endsWith("ing")) variants.add(token.slice(0, -3));
  return [...variants];
}

export function extractSearchPhrases(searchTerms = "") {
  const normalized = normalizeSearchText(searchTerms);
  const phrases = new Set();
  if (!normalized) return [];

  for (const entry of PHRASE_EXPANSIONS) {
    if (normalized.includes(entry.phrase)) {
      for (const variant of entry.variants) phrases.add(variant);
      phrases.add(entry.phrase);
    }
  }

  if (!phrases.size && normalized.split(" ").length >= 2) {
    phrases.add(normalized);
  }

  return [...phrases].sort((a, b) => b.length - a.length);
}

export function expandSearchTokens(searchTerms = "") {
  const normalized = normalizeSearchText(searchTerms);
  const rawTokens = normalized
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const expanded = new Set();
  for (const token of rawTokens) {
    for (const stem of simpleStemVariants(token)) {
      expanded.add(stem);
      const aliases = TOKEN_EXPANSIONS[stem] || TOKEN_EXPANSIONS[token];
      if (aliases) {
        for (const alias of aliases) expanded.add(alias);
      }
    }
  }

  for (const phrase of extractSearchPhrases(searchTerms)) {
    for (const token of phrase.split(/\s+/)) {
      if (token.length >= 2) expanded.add(token);
    }
  }

  return [...expanded];
}

/**
 * @returns {{ coreTokens: string[], phrases: string[], expandedTokens: string[], normalized: string }}
 */
export function buildSearchQueryContext(searchTerms = "") {
  const normalized = normalizeSearchText(searchTerms);
  const coreTokens = normalized
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const phrases = extractSearchPhrases(searchTerms);
  const expandedTokens = expandSearchTokens(searchTerms);

  return {
    normalized,
    coreTokens,
    phrases,
    expandedTokens,
  };
}

export function textIncludesToken(text, token) {
  const normalized = normalizeSearchText(text);
  const variants = new Set([token, ...simpleStemVariants(token), ...(TOKEN_EXPANSIONS[token] || [])]);
  for (const variant of variants) {
    if (variant.length >= 2 && normalized.includes(variant)) return true;
  }
  return false;
}

export function isHeaderOnlyChunk(row = {}) {
  const text = String(row.chunk_text || "").trim();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (!text) return true;

  if (HEADER_ONLY_PATTERNS.some((re) => re.test(text))) return true;
  if (TEMPLATE_CHUNK_PATTERNS.some((re) => re.test(normalizeSearchText(text)))) return true;

  if (text.length < 48 && lines.length <= 1 && !/\d/.test(text)) return true;
  if (lines.length <= 2 && lines.every((line) => line.length < 40 && !/[.!?]/.test(line) && !/\d/.test(line))) {
    const section = String(row.section_label || "").trim();
    if (section && normalizeSearchText(text) === normalizeSearchText(section)) return true;
  }

  return false;
}

function phraseMatchScore(text, phrase) {
  const normalized = normalizeSearchText(text);
  const target = normalizeSearchText(phrase);
  if (!target) return 0;
  const boundary = new RegExp(`\\b${target.replace(/\s+/g, "\\s+")}\\b`);
  if (boundary.test(normalized)) return 100;
  if (normalized.includes(target)) return 72;
  const parts = target.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => textIncludesToken(normalized, part))) return 55;
  return 0;
}

function operationalDetailScore(text) {
  const normalized = normalizeSearchText(text);
  let score = 0;
  if (/\btable\s+\d+/i.test(text)) score += 12;
  if (/\b\d+\s*(am|pm)\b/i.test(text)) score += 10;
  if (/\b(unavailable|available|complained|complaint|feedback|average|burning|cold|absent|sick)\b/i.test(normalized)) {
    score += 8;
  }
  if (text.length > 80) score += 5;
  return score;
}

function inferReportTypesFromQuery(text = "") {
  const q = normalizeSearchText(text);
  const types = new Set<string>();
  if (/\blogbook|daily log\b/.test(q)) types.add("daily_logbook");
  if (/\bcash up|cashup|sales performance\b/.test(q)) types.add("cash_up");
  if (/\breception|reservations?|covers|walkins?\b/.test(q)) types.add("reception_daily_report");
  if (/\bccm|reconciliation\b/.test(q)) types.add("ccm_reconciliation");
  if (/\boperations report|daily report|weekly report|uploaded report|reports\b/.test(q)) {
    types.add("daily_logbook");
    types.add("reception_daily_report");
  }
  return [...types];
}

function parseDateValue(value: unknown) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : time;
}

function dateOverlapScore(row: Record<string, unknown> = {}, vaultPeriod: Record<string, unknown> | null = null) {
  if (!vaultPeriod?.startDate || !vaultPeriod?.endDate) return 0;
  const rowStart = parseDateValue(row.period_start || row.periodStart);
  const rowEnd = parseDateValue(row.period_end || row.periodEnd || row.period_start || row.periodStart);
  const periodStart = parseDateValue(vaultPeriod.startDate);
  const periodEnd = parseDateValue(vaultPeriod.endDate);
  if (!rowStart || !rowEnd || !periodStart || !periodEnd) return 0;
  if (rowStart <= periodEnd && rowEnd >= periodStart) return 24;
  return -10;
}

function recencyScore(row: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  if (!options.preferRecent) return 0;
  const rowEnd = parseDateValue(row.period_end || row.periodEnd || row.period_start || row.periodStart);
  if (!rowEnd) return 0;
  const now = parseDateValue(options.referenceDate) || Date.now();
  const ageDays = Math.max(0, (now - rowEnd) / 86400000);
  if (ageDays <= 7) return 12;
  if (ageDays <= 31) return 8;
  if (ageDays <= 90) return 4;
  return 0;
}

function metadataRelevanceScore(row: Record<string, unknown> = {}, queryContext: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  let score = 0;
  const scopedBranch = options.scopedBranch || options.branch;
  if (scopedBranch && row.branch_id === scopedBranch) score += 18;

  const optionReportTypes = Array.isArray(options.reportTypes) ? options.reportTypes.map(String) : [];
  const requestedReportTypes = optionReportTypes.length
    ? optionReportTypes
    : inferReportTypesFromQuery(String(queryContext.normalized || ""));
  if (requestedReportTypes.length && requestedReportTypes.includes(String(row.report_type || ""))) score += 16;

  score += dateOverlapScore(row, (options.vaultPeriod as Record<string, unknown>) || null);
  score += recencyScore(row, options);
  return score;
}

/**
 * Score chunk relevance (higher is better).
 */
export function scoreChunkRelevance(row: Record<string, unknown> = {}, queryContext: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  const text = String(row.chunk_text || "");
  const normalized = normalizeSearchText(text);
  if (!normalized) return 0;

  const { coreTokens = [], phrases = [], expandedTokens = [] } = queryContext;
  let score = 0;

  let phraseScore = 0;
  for (const phrase of phrases) {
    phraseScore = Math.max(phraseScore, phraseMatchScore(text, phrase));
  }
  score += phraseScore;

  if (phrases.length === 0 && queryContext.normalized) {
    phraseScore = Math.max(phraseScore, phraseMatchScore(text, queryContext.normalized));
    score += phraseScore;
  }

  if (queryContext.normalized && normalized.includes(queryContext.normalized)) {
    score += 45;
  }

  if (coreTokens.length) {
    const coreHits = coreTokens.filter((token) => textIncludesToken(normalized, token)).length;
    const coreRatio = coreHits / coreTokens.length;
    if (coreHits === coreTokens.length) score += 55;
    else score += coreRatio * 25;
  }

  if (expandedTokens.length) {
    const expandedHits = expandedTokens.filter((token) => textIncludesToken(normalized, token)).length;
    score += (expandedHits / expandedTokens.length) * 20;
  }

  score += operationalDetailScore(text);

  const section = String(row.section_label || "").trim();
  if (section && coreTokens.some((token) => textIncludesToken(section, token))) score += 6;

  score += metadataRelevanceScore(row, queryContext, options);

  if (isHeaderOnlyChunk(row)) score -= 80;
  if (TEMPLATE_CHUNK_PATTERNS.some((re) => re.test(normalized))) score -= 50;

  return Math.max(0, score);
}

export function rankDocumentSearchChunks(rows: Record<string, unknown>[] = [], searchTerms = "", options: Record<string, unknown> = {}) {
  const queryContext = buildSearchQueryContext(searchTerms);
  return [...rows]
    .map((row) => ({
      row,
      relevanceScore: scoreChunkRelevance(row, queryContext, options),
    }))
    .filter((entry) => entry.relevanceScore > 0)
    .sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      const bDate = parseDateValue(b.row.period_end || b.row.periodEnd || b.row.period_start || b.row.periodStart) || 0;
      const aDate = parseDateValue(a.row.period_end || a.row.periodEnd || a.row.period_start || a.row.periodStart) || 0;
      if (bDate !== aDate) return bDate - aDate;
      return (a.row.chunk_index ?? 0) - (b.row.chunk_index ?? 0);
    })
    .slice(0, 20);
}

export function assessSearchMatchConfidence(matches = [], searchTerms = "") {
  if (!matches.length) return "low";
  const top = matches[0];
  const score =
    top.relevanceScore ??
    scoreChunkRelevance(top, buildSearchQueryContext(searchTerms || top.searchTerms || ""));
  if (score >= 80 && !isHeaderOnlyChunk(top)) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function extractRelevantSentences(text = "", searchTerms = "", maxSentences = 2) {
  const queryContext = buildSearchQueryContext(searchTerms);
  const sentences = String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const scored = sentences
    .map((sentence) => ({
      sentence,
      score: scoreChunkRelevance({ chunk_text: sentence }, queryContext),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored.slice(0, maxSentences).map((e) => e.sentence);
  return sentences.slice(0, maxSentences);
}

function formatLogbookLabel(fileTitle = "") {
  const title = String(fileTitle || "").replace(/\.(docx|pdf|txt)$/i, "").trim();
  return title || "uploaded logbook";
}

export function classifyOperationalIssue(text = "") {
  const normalized = normalizeSearchText(text);
  if (/\b(sick leave|absent|illness|on sick)\b/.test(normalized)) return "staff_absence";
  if (/\b(unavailable|sold out|86|not available)\b/.test(normalized)) return "availability";
  if (/\b(complain|complaint|feedback|remade|removed from bill)\b/.test(normalized)) return "complaint";
  if (/\b(average|quality|burning|cold|undercooked|too high|price)\b/.test(normalized)) return "food_quality";
  if (/\b(training|mod on duty|chef on duty)\b/.test(normalized)) return "operations";
  return "general";
}

export { extractRelevantSentences, formatLogbookLabel };

/**
 * Build an operations-assistant style direct answer from ranked evidence.
 */
export function buildOperationalSearchDirectAnswer(searchTerms, matches = []) {
  if (!matches.length) return null;

  const usable = matches.filter((m) => !isHeaderOnlyChunk(m));
  if (!usable.length) return null;

  const top = usable[0];
  const fileLabel = formatLogbookLabel(top.fileTitle);
  const section = top.sectionLabel ? String(top.sectionLabel).trim() : "";

  const sameFile = usable.filter((m) => m.fileTitle === top.fileTitle);
  const sentences = [];
  for (const match of sameFile.slice(0, 3)) {
    const text = match.chunkText || match.chunk_text || match.excerpt || "";
    for (const sentence of extractRelevantSentences(text, searchTerms, 2)) {
      if (!sentences.some((s) => normalizeSearchText(s) === normalizeSearchText(sentence))) {
        sentences.push(sentence);
      }
    }
    if (sentences.length >= 2) break;
  }

  if (!sentences.length) {
    const fallback = String(top.chunkText || top.chunk_text || top.excerpt || "").trim();
    if (fallback) sentences.push(fallback.slice(0, 220));
  }

  const evidence = sentences.slice(0, 2).join(" ");
  if (!evidence) return null;

  const sectionPhrase = section ? ` (${section})` : "";
  return `In the ${fileLabel}${sectionPhrase}, ${evidence}`;
}

/** @deprecated use rankDocumentSearchChunks */
export function rankChunksByTermOverlap(rows = [], tokens = [], searchTerms = "") {
  const ranked = rankDocumentSearchChunks(rows, searchTerms || tokens.join(" "));
  return ranked.map((entry) => entry.row);
}

/** @deprecated use scoreChunkRelevance */
export function scoreChunkTermOverlap(chunkText, tokens = []) {
  return scoreChunkRelevance(
    { chunk_text: chunkText },
    buildSearchQueryContext(Array.isArray(tokens) ? tokens.join(" ") : String(tokens || "")),
  ) / 100;
}

export function tokenizeDocumentSearchQuery(searchTerms = "") {
  return expandSearchTokens(searchTerms);
}
