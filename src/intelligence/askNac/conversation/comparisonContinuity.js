/**
 * Client mirror of the comparison-continuity predicates in
 * supabase/functions/_shared/companyIntelligence/conversationFollowUp.ts.
 * Production follow-up retention runs on the edge copy.
 */

function monthWords(question) {
  return String(question || "").toLowerCase().match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g) || [];
}

function stripContextReset(question) {
  const raw = String(question || "").trim();
  const match = raw.match(/^(?:forget that|forget it|start over|never mind|reset context)(?:\s+that)?[,:]?\s*(.*)$/i);
  if (!match) return { question: raw, reset: false };
  return { question: String(match[1] || "").trim(), reset: true };
}

export function isNonCommercialSourceQuestion(question) {
  const q = String(question || "").toLowerCase();
  if (/\b(menu qr|menu scans?|qr scans?)\b/.test(q) && !/\b(net sales|cash up|covers per|orders per)\b/.test(q)) return true;
  if (/\b(review qr|google reviews?|google redirects?|review events?)\b/.test(q)) return true;
  return false;
}

export function isAmbiguousManagementFollowUp(question) {
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (/^(?:what|how) about that$/.test(q)) return true;
  if (/^and the previous month$/.test(q)) return true;
  return false;
}

export function isBranchOnlyFollowUp(question) {
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  const focus = q.replace(/^(?:what about|how about|and)\s+(?:the\s+)?/, "");
  return /^(?:riyadh|jeddah|khobar|al khobar)$/.test(focus);
}

export function isExplicitComparisonReset(question) {
  const q = stripContextReset(question).question.toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (/^(?:and\s+)?(?:yesterday|today|last week|this week|last month|this month)$/.test(q)) return true;
  if (/^(?:what about|how about)\s+(?:yesterday|today|last week|this week|last month|this month)$/.test(q)) return true;
  if (/^(?:sales|covers|orders|guests|revenue)(?:\s+of)?\s+(?:yesterday|today)$/.test(q)) return true;
  if (/\bhow many\b/.test(q) && !/\b(covers|orders)\b/.test(q)) return true;
  if (/\bhow many\b/.test(q) && /\b(today|yesterday)\b/.test(q)) return true;
  return false;
}

export function isSelfContainedManagementQuestion(question) {
  const q = String(question || "").toLowerCase();
  const months = monthWords(q);
  if (months.length < 2) return false;
  return /\b(?:compare|vs|versus|why|lower|higher|better|worse|changed|difference|explain)\b/.test(q);
}

export function isComparisonAnalysisFollowUp(question) {
  if (
    isExplicitComparisonReset(question)
    || isSelfContainedManagementQuestion(question)
    || isNonCommercialSourceQuestion(question)
    || isAmbiguousManagementFollowUp(question)
    || isBranchOnlyFollowUp(question)
  ) return false;
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (/\b(visuali[sz]e|chart|graph|break it down|daily breakdown)\b/.test(q)) return false;
  const focus = q.replace(/^(?:what about|how about|and|same but|same comparison but)\s+(?:the\s+)?/, "");
  if (/^(?:yesterday|today|last week|this week|last month|this month|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(focus)
    && !/\b(?:per day|covers|orders|spend|days)\b/.test(focus)) {
    return false;
  }
  return /^(?:per day|sales per day|covers|orders|average spend|avg spend|spend per cover|average order|aov|best days?|worst days?|why|why though|what changed)$/.test(focus)
    || /\b(?:per day|covers|orders|average spend|spend per cover|average order|first\s+\d+\s+days|best days|worst days|top\s+\d+\s+days|stronger daily|doing better per day)\b/.test(q)
    || /^why\b/.test(q)
    || /\bwhat changed\b/.test(q)
    || /\bwhich had the best\b/.test(q)
    || /\bwhich one is (?:doing better|stronger|higher|lower)\b/.test(q)
    || /\bsame (?:but|comparison)\b/.test(q);
}
