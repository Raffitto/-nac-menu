/**
 * Manager-style operational answers, related findings, and cross-document synthesis (Edge).
 */

import {
  buildSearchQueryContext,
  classifyOperationalIssue,
  extractRelevantSentences,
  formatLogbookLabel,
  isHeaderOnlyChunk,
  normalizeSearchText,
  scoreChunkRelevance,
} from "./vaultDocumentSearchRanking.ts";

export { classifyOperationalIssue };

const OPERATIONAL_REVIEW_PATTERNS = [
  /\bwhat complaints happened\b/i,
  /\bcomplaints this week\b/i,
  /\bwhat should management know\b/i,
  /\bmanagement know from (the )?(uploaded )?logbooks?\b/i,
  /\bsummarize.*logbooks?\b/i,
  /\bsummarize (uploaded )?(reports?|documents?|files)\b/i,
  /\bwhat happened\b.*\b(logbooks?|uploaded reports?|reports?)\b/i,
  /\boperational issues this week\b/i,
  /\bany recurring issues?\b/i,
  /\b(maintenance|operational|staff|sop|policy|manual).*\b(issues?|concerns?|violations?|repeat|recurring|follow[\s-]?ups?|action items?)\b/i,
  /\b(issues?|concerns?|violations?|incidents?).*\b(uploaded reports?|reports?|documents?|logbooks?|sop|policy|manual)\b/i,
  /\bfood quality complaints?\b/i,
  /\bstaff absence\b/i,
  /\bany staff absent\b/i,
  /\brecurring (issues?|problems?|complaints?)\b/i,
  /\broot cause\b.*\b(issues?|incidents?|complaints?|reports?)\b/i,
  /\boperations report\b/i,
  /\bdaily report\b/i,
  /\bweekly report\b/i,
];

const THEME_SEARCH_TERMS: Record<string, string> = {
  complaints: "guest complaint feedback table remade removed bill quality taste",
  recurring: "complaint issue feedback recurring repeated again same problem",
  maintenance: "maintenance repair equipment ac hvac leak broken issue repeated recurring follow up",
  staff_concerns: "staff concern concerns absence sick leave training performance complaint follow up",
  sop: "sop policy manual violation non compliance procedure standard follow up action item",
  staff_absence: "sick leave absent illness staff reception",
  food_quality: "food quality average taste burning cold undercooked price high",
  reports: "operational issue complaint concern maintenance incident follow up action item root cause",
  management: "complaint operational issue unavailable staff training feedback management",
  general: "complaint operational issue unavailable staff feedback guest table",
};

export function isVaultOperationalReviewQuery(question = "") {
  const q = String(question || "").trim();
  if (!q) return false;
  return OPERATIONAL_REVIEW_PATTERNS.some((re) => re.test(q));
}

export function extractOperationalReviewTheme(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(sop|policy|manual|violation|violations)\b/.test(q)) return "sop";
  if (/\bmaintenance|repair|equipment|ac|hvac|broken|leak\b/.test(q)) return "maintenance";
  if (/\bstaff\b.*\b(concern|concerns|issue|issues|reports?)\b/.test(q)) return "staff_concerns";
  if (/\b(staff absence|absent|sick leave)\b/.test(q)) return "staff_absence";
  if (/\b(food quality|quality complaint)\b/.test(q)) return "food_quality";
  if (/\b(recurring|repeated|again)\b/.test(q)) return "recurring";
  if (/\b(complaint|complaints)\b/.test(q)) return "complaints";
  if (/\b(uploaded reports?|reports?|logbooks?|documents?)\b/.test(q)) return "reports";
  if (/\bmanagement know\b/.test(q)) return "management";
  return "general";
}

export function searchTermsForOperationalTheme(theme = "general") {
  return THEME_SEARCH_TERMS[theme] || THEME_SEARCH_TERMS.general;
}

function extractDateFromFileTitle(fileTitle = "") {
  const title = String(fileTitle || "");
  const dayMonth = title.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  );
  if (dayMonth) return `${dayMonth[1]} ${dayMonth[2]}`;
  return null;
}

function inferSeverity(text = "", issueType = "general") {
  const normalized = normalizeSearchText(text);
  if (/\b(removed from bill|remade|guest satisfied|resolved)\b/.test(normalized)) return "medium";
  if (/\b(unavailable|sold out|86|absent|sick leave|burning|undercooked|too high)\b/.test(normalized)) {
    return "high";
  }
  if (issueType === "staff_absence") return "medium";
  if (/\bfeedback\b/.test(normalized)) return "low";
  return "medium";
}

export function groupOperationalMatches(matches: Record<string, unknown>[] = []) {
  const groups: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (isHeaderOnlyChunk(match)) continue;
    const text = String(match.chunkText || match.excerpt || "");
    if (!text.trim()) continue;

    const key = `${match.fileId || match.fileTitle}|${normalizeSearchText(text).slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const issueType = classifyOperationalIssue(text);
    groups.push({
      date: match.periodStart || extractDateFromFileTitle(String(match.fileTitle || "")),
      issueType,
      severity: inferSeverity(text, issueType),
      actionTaken: /\b(remade|removed from bill|guest satisfied|available at|resolved)\b/i.test(text)
        ? text.match(/\b(remade|removed from bill|guest satisfied|available at \d|resolved)[^.]*/i)?.[0] || "Noted in logbook"
        : "Noted in logbook",
      excerpt: text.slice(0, 220),
      source: match.citation || match.fileTitle,
      fileTitle: match.fileTitle,
      sectionLabel: match.sectionLabel,
      relevanceScore: (match.relevanceScore as number) ?? 0,
    });
  }

  return groups.sort((a, b) => ((b.relevanceScore as number) || 0) - ((a.relevanceScore as number) || 0));
}

function findRelatedFindings(
  primaryMatch: Record<string, unknown>,
  allMatches: Record<string, unknown>[] = [],
  searchTerms = "",
) {
  if (!primaryMatch || !allMatches.length) return [];

  const primaryFile = primaryMatch.fileTitle;
  const primaryDate = extractDateFromFileTitle(String(primaryMatch.fileTitle || ""));
  const primaryIssue = classifyOperationalIssue(String(primaryMatch.chunkText || primaryMatch.excerpt || ""));
  const queryContext = buildSearchQueryContext(searchTerms);

  const related: Record<string, unknown>[] = [];
  const seen = new Set([normalizeSearchText(String(primaryMatch.chunkText || primaryMatch.excerpt || "")).slice(0, 60)]);

  for (const match of allMatches) {
    if (match.fileTitle === primaryMatch.fileTitle && match.chunkIndex === primaryMatch.chunkIndex) continue;
    if (isHeaderOnlyChunk(match)) continue;

    const text = String(match.chunkText || match.excerpt || "");
    if (!text.trim()) continue;
    const norm = normalizeSearchText(text).slice(0, 60);
    if (seen.has(norm)) continue;

    const sameDate = primaryDate && extractDateFromFileTitle(String(match.fileTitle || "")) === primaryDate;
    const sameFile = match.fileTitle === primaryFile;
    const issueType = classifyOperationalIssue(text);
    const issueRelated =
      issueType === primaryIssue
      || (primaryIssue === "availability" && issueType === "availability")
      || (["complaint", "food_quality"].includes(primaryIssue) && ["complaint", "food_quality"].includes(issueType))
      || (primaryIssue === "staff_absence" && issueType === "staff_absence");

    const tokenRelated = scoreChunkRelevance({ chunk_text: text }, queryContext) >= 25;

    if (sameFile || sameDate || issueRelated || tokenRelated) {
      seen.add(norm);
      related.push({
        fileTitle: match.fileTitle,
        sectionLabel: match.sectionLabel,
        excerpt: text.slice(0, 160),
        citation: match.citation,
        issueType,
      });
    }

    if (related.length >= 4) break;
  }

  return related;
}

function buildManagementNote(searchTerms = "", evidenceText = "", issueType = "general") {
  const text = normalizeSearchText(evidenceText);
  if (!text) return null;

  if (issueType === "availability" || /\b(unavailable|sold out|86|available at)\b/.test(text)) {
    if (/\bavailable at \d|available again\b/.test(text)) {
      return "This appears to be a temporary availability issue, not a full-day 86 item.";
    }
    return "Track whether this item stays unavailable across upcoming services.";
  }

  if (issueType === "complaint" || issueType === "food_quality") {
    if (/\b(remade|removed from bill|guest satisfied)\b/.test(text)) {
      return "Guest issue was handled in-service; monitor for repeat feedback on the same item.";
    }
    return "Follow up with kitchen/service to prevent repeat guest complaints.";
  }

  if (issueType === "staff_absence") {
    return "Confirm reception/FOH coverage plan for the affected shift.";
  }

  if (/\bprice was too high|average\b/.test(text)) {
    return "Guest perceived value issue — review pricing vs. portion/quality for this item.";
  }

  return "Review the source logbook entry with the duty manager for context.";
}

export function buildCrossDocumentOperationalSummary(
  groupedFindings: Record<string, unknown>[] = [],
  theme = "general",
) {
  if (!groupedFindings.length) {
    return {
      answer: "No operational findings matched this review under your access scope.",
      managementNote: "Upload or re-index daily logbooks for the period, then retry.",
      relatedFindings: [] as Record<string, unknown>[],
      source: null as string | null,
    };
  }

  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const item of groupedFindings) {
    const dateKey = String(item.date || item.fileTitle || "Unknown date");
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(item);
  }

  const answerLines: string[] = [];
  for (const [date, items] of byDate) {
    const highlights = items.slice(0, 2).map((item) => {
      const typeLabel = String(item.issueType || "general").replace(/_/g, " ");
      return `${typeLabel}: ${String(item.excerpt || "").slice(0, 100)}`;
    });
    answerLines.push(`${date} — ${highlights.join("; ")}`);
  }

  const highSeverity = groupedFindings.filter((g) => g.severity === "high").length;
  const managementNote =
    theme === "recurring"
      ? "Look for repeated items or complaint types across dates before escalating."
      : highSeverity
        ? `${highSeverity} higher-severity item(s) flagged — duty manager review recommended.`
        : "Issues appear isolated; confirm follow-up actions were completed in each logbook.";

  return {
    answer: answerLines.slice(0, 6).join("\n"),
    managementNote,
    relatedFindings: groupedFindings.slice(0, 6),
    source: groupedFindings.slice(0, 3).map((g) => g.source).join("; "),
  };
}

export function buildOperationalManagerAnswer(searchTerms: string, matches: Record<string, unknown>[] = []) {
  const usable = matches.filter((m) => !isHeaderOnlyChunk(m));
  if (!usable.length) return null;

  const top = usable[0];
  const fileLabel = formatLogbookLabel(String(top.fileTitle || ""));
  const section = top.sectionLabel ? String(top.sectionLabel).trim() : "";
  const evidenceText = String(top.chunkText || top.excerpt || "");

  const sameFile = usable.filter((m) => m.fileTitle === top.fileTitle);
  const sentences: string[] = [];
  for (const match of sameFile.slice(0, 3)) {
    const text = String(match.chunkText || match.excerpt || "");
    for (const sentence of extractRelevantSentences(text, searchTerms, 2)) {
      if (!sentences.some((s) => normalizeSearchText(s) === normalizeSearchText(sentence))) {
        sentences.push(sentence);
      }
    }
    if (sentences.length >= 2) break;
  }

  if (!sentences.length && evidenceText) {
    sentences.push(evidenceText.slice(0, 220));
  }

  const answerBody = sentences.slice(0, 2).join(" ");
  const answer = answerBody
    ? `On ${extractDateFromFileTitle(String(top.fileTitle || "")) || "this date"}, ${answerBody.replace(/^\[?\d+\s+\w+[^]]*\]?\s*/i, "")}`
    : null;

  const issueType = classifyOperationalIssue(evidenceText);
  const managementNote = buildManagementNote(searchTerms, evidenceText, issueType);
  const source = [fileLabel, section].filter(Boolean).join(" · ");
  const relatedFindings = findRelatedFindings(top, usable, searchTerms);

  return {
    answer: answer || `In the ${fileLabel}${section ? ` (${section})` : ""}, ${evidenceText.slice(0, 180)}`,
    managementNote,
    source,
    relatedFindings,
    issueType,
  };
}

export function scoreVaultOperationalReviewIntent(q = "") {
  const text = String(q || "").trim();
  if (!text) return 0;
  if (/\bexecutive summary\b/i.test(text)) return 0;
  if (/\bsearch company knowledge\b/i.test(text)) return 0;
  if (!isVaultOperationalReviewQuery(text)) return 0;

  if (/\b(sop|policy|manual).*\b(violations?|issues?|concerns?)\b/.test(text)) return 29;
  if (/\b(maintenance|staff).*\b(issues?|concerns?|repeat|recurring)\b/.test(text)) return 29;
  if (/\bwhat happened\b.*\b(logbooks?|uploaded reports?|reports?)\b/.test(text)) return 28;
  if (/\bsummarize (uploaded )?(reports?|documents?|files)\b/.test(text)) return 28;
  if (/\b(recurring|repeat|repeated).*\b(operational )?issues?\b/.test(text)) return 28;
  if (/\bwhat complaints happened\b/.test(text)) return 24;
  if (/\bwhat should management know\b/.test(text) && /\blogbook/.test(text)) return 24;
  if (/\bany recurring issues?\b/.test(text)) return 23;
  if (/\bfood quality complaints?\b/.test(text)) return 23;
  if (/\bstaff absence\b/.test(text)) return 23;
  if (/\bsummarize.*logbooks?\b/.test(text)) return 22;
  if (/\b(this week|current week|past week)\b/.test(text)) return 22;
  return 21;
}
