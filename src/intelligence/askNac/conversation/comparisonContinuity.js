/**
 * Client mirror of the comparison-continuity predicates in
 * supabase/functions/_shared/companyIntelligence/conversationFollowUp.ts.
 * Production follow-up retention runs on the edge copy.
 */

function monthWords(question) {
  return String(question || "").toLowerCase().match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g) || [];
}

export function isExplicitComparisonReset(question) {
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (/^(?:and\s+)?(?:yesterday|today|last week|this week|last month|this month)$/.test(q)) return true;
  if (/^(?:sales|covers|orders|guests|revenue)(?:\s+of)?\s+(?:yesterday|today)$/.test(q)) return true;
  if (/\bhow many\b/.test(q)) return true;
  return false;
}

export function isSelfContainedManagementQuestion(question) {
  const q = String(question || "").toLowerCase();
  const months = monthWords(q);
  if (months.length < 2) return false;
  return /\b(?:compare|vs|versus|why|lower|higher|better|worse|changed|difference|explain)\b/.test(q);
}

export function isComparisonAnalysisFollowUp(question) {
  if (isExplicitComparisonReset(question) || isSelfContainedManagementQuestion(question)) return false;
  const q = String(question || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  const focus = q.replace(/^(?:what about|how about|and)\s+(?:the\s+)?/, "");
  if (/^(?:yesterday|today|last week|this week|last month|this month|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(focus)
    && !/\b(?:per day|covers|orders|spend|days)\b/.test(focus)) {
    return false;
  }
  return /^(?:per day|sales per day|covers|orders|average spend|avg spend|spend per cover|average order|aov|best days?|worst days?|why)$/.test(focus)
    || /\b(?:per day|covers|orders|average spend|spend per cover|average order|first\s+\d+\s+days|best days|worst days)\b/.test(q)
    || /^why\b/.test(q)
    || /\bwhat changed the most\b/.test(q)
    || /\bwhich had the best\b/.test(q);
}
