/**
 * Manager-style operational answers, related findings, and cross-document synthesis.
 */

import {
  buildSearchQueryContext,
  classifyOperationalIssue,
  extractRelevantSentences,
  formatLogbookLabel,
  isHeaderOnlyChunk,
  normalizeSearchText,
  scoreChunkRelevance,
} from "./vaultDocumentSearchRanking";
import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser";

export { classifyOperationalIssue };

const OPERATIONAL_REVIEW_PATTERNS = [
  /\bwhat complaints happened\b/i,
  /\bcomplaints this week\b/i,
  /\bwhat should management know\b/i,
  /\bmanagement know from (the )?(uploaded )?logbooks?\b/i,
  /\bsummarize.*logbooks?\b/i,
  /\bsummarize (uploaded )?(reports?|documents?|files)\b/i,
  /\bwhat happened\b.*\b(logbooks?|uploaded reports?|reports?)\b/i,
  /\bwhat happened operationally\b/i,
  /\bsummarize\b.*\b(january|february|march|april|may|june|july|august|september|october|november|december)\b.*\boperations?\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b.*\boperations?\b/i,
  /\boperations?\s+(?:in|for|during)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(main|biggest|recurring)\b.*\b(operational )?issues?\b/i,
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

const THEME_SEARCH_TERMS = Object.freeze({
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
});

export function isVaultOperationalReviewQuery(question = "") {
  const q = String(question || "").trim();
  if (!q) return false;
  const period = parseVaultPeriodFromQuestion(q);
  if (period?.isSingleDay && /\b(what happened|summarize|summary|operationally)\b/i.test(q)) {
    return false;
  }
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

export function extractDateFromFileTitle(fileTitle = "") {
  const title = String(fileTitle || "");
  const dayMonth = title.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  if (dayMonth) return `${dayMonth[1]} ${dayMonth[2]}`;
  return null;
}

export function inferSeverity(text = "", issueType = "general") {
  const normalized = normalizeSearchText(text);
  if (/\b(removed from bill|remade|guest satisfied|resolved)\b/.test(normalized)) return "medium";
  if (/\b(unavailable|sold out|86|absent|sick leave|burning|undercooked|too high)\b/.test(normalized)) {
    return "high";
  }
  if (issueType === "staff_absence") return "medium";
  if (/\bfeedback\b/.test(normalized)) return "low";
  return "medium";
}

export function groupOperationalMatches(matches = []) {
  const groups = [];
  const seen = new Set();

  for (const match of matches) {
    if (isHeaderOnlyChunk(match)) continue;
    const text = match.chunkText || match.excerpt || "";
    if (!text.trim()) continue;

    const key = `${match.fileId || match.fileTitle}|${normalizeSearchText(text).slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const issueType = classifyOperationalIssue(text);
    groups.push({
      date: match.periodStart || extractDateFromFileTitle(match.fileTitle),
      issueType,
      severity: inferSeverity(text, issueType),
      actionTaken: /\b(remade|removed from bill|guest satisfied|available at|resolved)\b/i.test(text)
        ? text.match(/\b(remade|removed from bill|guest satisfied|available at \d|resolved)[^.]*/i)?.[0] || "Noted in logbook"
        : "Noted in logbook",
      excerpt: text.slice(0, 220),
      source: match.citation || match.fileTitle,
      fileTitle: match.fileTitle,
      sectionLabel: match.sectionLabel,
      relevanceScore: match.relevanceScore ?? 0,
    });
  }

  return groups.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
}

export function findRelatedFindings(primaryMatch, allMatches = [], searchTerms = "") {
  if (!primaryMatch || !allMatches.length) return [];

  const primaryFile = primaryMatch.fileTitle;
  const primaryDate = extractDateFromFileTitle(primaryMatch.fileTitle);
  const primaryIssue = classifyOperationalIssue(primaryMatch.chunkText || primaryMatch.excerpt || "");
  const queryContext = buildSearchQueryContext(searchTerms);

  const related = [];
  const seen = new Set([normalizeSearchText(primaryMatch.chunkText || primaryMatch.excerpt || "").slice(0, 60)]);

  for (const match of allMatches) {
    if (match.fileTitle === primaryMatch.fileTitle && match.chunkIndex === primaryMatch.chunkIndex) continue;
    if (isHeaderOnlyChunk(match)) continue;

    const text = match.chunkText || match.excerpt || "";
    if (!text.trim()) continue;
    const norm = normalizeSearchText(text).slice(0, 60);
    if (seen.has(norm)) continue;

    const sameDate = primaryDate && extractDateFromFileTitle(match.fileTitle) === primaryDate;
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

export function buildManagementNote(searchTerms = "", evidenceText = "", issueType = "general") {
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

export function formatManagerStyleAnswer({
  answer,
  managementNote = null,
  source = null,
  relatedFindings = [],
  confidence = "medium",
}) {
  const sections = [];
  if (answer) sections.push(`Answer:\n${answer}`);
  if (managementNote) sections.push(`Management note:\n${managementNote}`);
  if (source) sections.push(`Source:\n${source}`);
  if (relatedFindings.length) {
    const lines = relatedFindings.slice(0, 4).map((item) => {
      const date = extractDateFromFileTitle(item.fileTitle);
      const prefix = date ? `${date}: ` : "";
      return `- ${prefix}${item.excerpt?.slice(0, 120) || item.fileTitle}`;
    });
    sections.push(`Related findings:\n${lines.join("\n")}`);
  }
  sections.push(`Confidence:\n${String(confidence).charAt(0).toUpperCase()}${String(confidence).slice(1)}`);
  return sections.join("\n\n");
}

export function buildCrossDocumentOperationalSummary(groupedFindings = [], theme = "general") {
  if (!groupedFindings.length) {
    return {
      answer: "No operational findings matched this review under your access scope.",
      managementNote: "Upload or re-index daily logbooks for the period, then retry.",
      relatedFindings: [],
    };
  }

  const byDate = new Map();
  for (const item of groupedFindings) {
    const dateKey = item.date || item.fileTitle || "Unknown date";
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(item);
  }

  const answerLines = [];
  for (const [date, items] of byDate) {
    const highlights = items.slice(0, 2).map((item) => {
      const typeLabel = item.issueType.replace(/_/g, " ");
      return `${typeLabel}: ${item.excerpt.slice(0, 100)}`;
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

export function buildOperationalManagerAnswer(searchTerms, matches = []) {
  const usable = matches.filter((m) => !isHeaderOnlyChunk(m));
  if (!usable.length) return null;

  const top = usable[0];
  const fileLabel = formatLogbookLabel(top.fileTitle);
  const section = top.sectionLabel ? String(top.sectionLabel).trim() : "";
  const evidenceText = top.chunkText || top.excerpt || "";

  const sameFile = usable.filter((m) => m.fileTitle === top.fileTitle);
  const sentences = [];
  for (const match of sameFile.slice(0, 3)) {
    const text = match.chunkText || match.excerpt || "";
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
    ? `On ${extractDateFromFileTitle(top.fileTitle) || "this date"}, ${answerBody.replace(/^\[?\d+\s+\w+[^]]*\]?\s*/i, "")}`
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
