/**
 * Mobile-only presentation helpers — formats copy for chat UI without changing response data.
 */

function ensurePeriod(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function branchPhrase(branch) {
  const raw = String(branch || "").trim();
  if (!raw || /network|all branches/i.test(raw)) return "the network";
  return raw.replace(/^nac$/i, "Khobar");
}

function periodPhrase(period) {
  const raw = String(period || "").trim();
  if (!raw) return "Recently";
  if (/^today$/i.test(raw)) return "Today";
  if (/^yesterday$/i.test(raw)) return "Yesterday";
  if (/^this month$/i.test(raw)) return "This month";
  if (/^last month$/i.test(raw)) return "Last month";
  if (/last 7 days/i.test(raw)) return "In the last 7 days";
  if (/^this week$/i.test(raw)) return "This week";
  if (/^last week$/i.test(raw)) return "Last week";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function humanizeGeneric(text) {
  let result = String(text || "").trim();
  if (!result) return result;
  result = result.charAt(0).toUpperCase() + result.slice(1);
  result = result.replace(/\bqr\b/gi, "QR");
  result = result.replace(/\bfor network \(all branches\)/gi, "across the network");
  result = result.replace(/\bNetwork \(all branches\)/gi, "the network");
  return ensurePeriod(result);
}

/**
 * Executive-style lead sentence for mobile chat. Preserves numeric/currency tokens from directAnswer.
 */
export function formatMobileAnswerLead(response) {
  const raw = String(response?.directAnswer || "").trim();
  if (!raw) return raw;

  if (response?.isAiGenerated && raw.split(/\s+/).length >= 8 && /[.!?]/.test(raw)) {
    return ensurePeriod(raw);
  }

  let match = raw.match(/^([\d,]+)\s+menu qr scans for (.+?) \((.+?)\)\.?$/i);
  if (match) {
    const [, count, branch, period] = match;
    return `${periodPhrase(period)}, ${branchPhrase(branch)} recorded ${count} menu QR scans.`;
  }

  match = raw.match(/^([\d,]+)\s+menu qr scans for (.+?)\.?$/i);
  if (match) {
    const [, count, branch] = match;
    return `${branchPhrase(branch).replace(/^the /, "The ")} recorded ${count} menu QR scans.`;
  }

  match = raw.match(/^SAR\s+([\d,]+\.?\d*)\s+net sales for (.+?) \((.+?)\)\.?$/i);
  if (match) {
    const [, amount, branch, period] = match;
    const periodText = periodPhrase(period).toLowerCase();
    return `${branchPhrase(branch).replace(/^the /, "The ")} recorded net sales of SAR ${amount} ${periodText}.`;
  }

  match = raw.match(/^(?:the\s+)?(.+?)\s+category generated (SAR [\d,]+\.?\d*)/i);
  if (match) {
    const [, category, amount] = match;
    return `The ${category.trim()} category generated the highest revenue, totaling ${amount}.`;
  }

  match = raw.match(/^([\d,]+)\s+google redirects for (.+?) \((.+?)\)\.?$/i);
  if (match) {
    const [, count, branch, period] = match;
    return `${periodPhrase(period)}, ${branchPhrase(branch)} recorded ${count} Google redirects.`;
  }

  match = raw.match(/^(.+?) drove the most google redirects/i);
  if (match) {
    return humanizeGeneric(raw);
  }

  return humanizeGeneric(raw);
}
