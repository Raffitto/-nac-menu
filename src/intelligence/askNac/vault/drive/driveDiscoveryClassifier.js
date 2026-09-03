/**
 * Smart Drive Discovery — folder/path classifier with approval actions.
 */

export const DISCOVERY_REPORT_TYPES = [
  "cash_up",
  "daily_logbook",
  "daily_reception",
  "daily_briefing",
  "ccm_reconciliation",
  "breakage_report",
  "discount_void_comp",
  "guest_feedback",
  "google_review_tracking",
  "weekly_dashboard",
  "food_safety_haccp",
  "food_safety_temperature",
  "food_safety_receiving",
  "waste_report",
  "supplier_evaluation",
  "ignore",
  "unknown_needs_review",
];

export const DISCOVERY_TO_VAULT_REPORT_TYPE = {
  cash_up: "cash_up",
  daily_logbook: "daily_logbook",
  daily_reception: "reception_daily_report",
  daily_briefing: "daily_briefing",
  ccm_reconciliation: "ccm_reconciliation",
  breakage_report: "breakage_report",
  discount_void_comp: "discount_void_comp",
  guest_feedback: "guest_feedback",
  google_review_tracking: "google_review_tracking",
  weekly_dashboard: "weekly_dashboard",
  food_safety_haccp: "food_safety_haccp",
  food_safety_temperature: "food_safety_temperature",
  food_safety_receiving: "food_safety_receiving",
  waste_report: "waste_report",
  supplier_evaluation: "supplier_evaluation",
  ignore: null,
  unknown_needs_review: null,
};

const CLASSIFIER_PATTERNS = [
  { pattern: /\breview\s+tracking\b/i, type: "google_review_tracking", action: "ingest", confidence: 0.99, reason: "Google Drive 2026 review tracking workbook." },
  { pattern: /\bcash[\s-]?up\b|\bcashup\b/i, type: "cash_up", action: "ingest", confidence: 0.98, reason: "Cash-up folder name match." },
  { pattern: /\blog\s?book\b/i, type: "daily_logbook", action: "ingest", confidence: 0.97, reason: "Daily logbook folder name match." },
  { pattern: /\bdaily reception\b|\breception daily\b/i, type: "daily_reception", action: "ingest", confidence: 0.96, reason: "Daily reception folder name match." },
  { pattern: /\bdaily briefing\b|\bbriefing\b/i, type: "daily_briefing", action: "ingest", confidence: 0.94, reason: "Daily briefing folder name match." },
  { pattern: /\bccm\b|\bfoodics\b|\breconciliation\b/i, type: "ccm_reconciliation", action: "ingest", confidence: 0.95, reason: "CCM / Foodics reconciliation folder." },
  { pattern: /\bbreakage\b/i, type: "breakage_report", action: "ingest", confidence: 0.94, reason: "Breakage reporting folder." },
  {
    pattern: /\bdiscount\b|\bcomp\b|\bvoids?\b|\bvoids?\s+discounts?\b|\bdiscounts?\s+and\s+comp\b/i,
    type: "discount_void_comp",
    action: "ingest",
    confidence: 0.93,
    reason: "Discount / void / comp folder (same category across CEO renames).",
  },
  { pattern: /\bguest feedback\b/i, type: "guest_feedback", action: "ask", confidence: 0.72, reason: "Guest Feedback purpose may vary — confirm before ingest." },
  { pattern: /\bweekly dashboards?\b|\bexecutive reports?\b.*\bweekly\b/i, type: "weekly_dashboard", action: "ingest", confidence: 0.96, reason: "Executive weekly dashboard folder." },
  { pattern: /\bhaccp\b/i, type: "food_safety_haccp", action: "ingest", confidence: 0.95, reason: "HACCP / food safety manual folder." },
  { pattern: /\btemperature log\b|\btemp(?:erature)?\s+monitor/i, type: "food_safety_temperature", action: "ingest", confidence: 0.94, reason: "Temperature monitoring folder." },
  { pattern: /\breceiving\b/i, type: "food_safety_receiving", action: "ingest", confidence: 0.93, reason: "Receiving checklist folder." },
  { pattern: /\bwaste\b|\bspoilage\b/i, type: "waste_report", action: "ingest", confidence: 0.92, reason: "Waste / spoilage reporting folder." },
  { pattern: /\bsupplier evaluation\b/i, type: "supplier_evaluation", action: "ingest", confidence: 0.91, reason: "Supplier evaluation folder." },
  { pattern: /\bdaily napkins count\b|\bnapkins count\b/i, type: "ignore", action: "ignore", confidence: 0.99, reason: "Explicitly excluded Daily Napkins Count folder." },
  { pattern: /\bmonthly cash safe\b/i, type: "ignore", action: "ignore", confidence: 0.99, reason: "Explicitly excluded Monthly Cash Safe folder." },
];

export const DISCOVERY_CLARIFYING_QUESTIONS = {
  guest_feedback: "Is Guest Feedback operational feedback, customer complaints, or Google review tracking?",
  breakage_report: "Should Breakage be used for asset-loss reporting and staff accountability?",
  discount_void_comp: "Should Discount and comp be grouped with voids/discounts?",
};

export function normalizeDrivePath(path = "") {
  return String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

export function extractOperationalFolderPath(folderPath = "", fileName = "") {
  const normalized = normalizeDrivePath(folderPath);
  const parts = normalized.split("/");
  if (!parts.length) return normalized || String(fileName || "").trim();
  if (parts.length >= 2) return parts.slice(0, 2).join("/");
  return parts[0];
}

export function resolveVaultReportType(discoveryType) {
  return DISCOVERY_TO_VAULT_REPORT_TYPE[discoveryType] || null;
}

function patternSpecificity(pattern = "") {
  return String(pattern || "").length;
}

export function matchDiscoveryRule(folderPath = "", fileName = "", rules = [], branchId = null) {
  const normalizedPath = normalizeDrivePath(folderPath);
  const normalizedName = String(fileName || "").trim();
  const scoped = (rules || []).filter((rule) => rule?.active !== false);
  const branchScoped = scoped.filter((rule) => !rule.branch_id || !branchId || rule.branch_id === branchId);
  const sorted = [...branchScoped].sort(
    (a, b) => patternSpecificity(b.folder_path_pattern) - patternSpecificity(a.folder_path_pattern),
  );

  for (const rule of sorted) {
    const folderPattern = String(rule.folder_path_pattern || "").trim();
    const filePattern = String(rule.file_name_pattern || "").trim();
    if (!folderPattern) continue;
    const folderHit =
      normalizedPath.toLowerCase().includes(folderPattern.toLowerCase())
      || normalizedPath.split("/").some((part) => part.toLowerCase() === folderPattern.toLowerCase());
    if (!folderHit) continue;
    if (filePattern && normalizedName && !new RegExp(filePattern, "i").test(normalizedName)) continue;
    return rule;
  }
  return null;
}

export function classifyDrivePath(folderPath = "", fileName = "", rules = [], branchId = null) {
  const normalizedPath = normalizeDrivePath(folderPath);
  const operationalPath = extractOperationalFolderPath(normalizedPath, fileName);
  const matchedRule = matchDiscoveryRule(normalizedPath, fileName, rules, branchId);

  if (matchedRule) {
    const detected = matchedRule.detected_report_type;
    const action = matchedRule.action;
    return {
      folderPath: normalizedPath,
      operationalPath,
      detectedReportType: detected,
      vaultReportType: resolveVaultReportType(detected),
      action,
      recommendedAction: action,
      confidence: Number(matchedRule.confidence) || 0.8,
      reason: matchedRule.reason || `Matched approved rule: ${matchedRule.folder_path_pattern}`,
      ruleId: matchedRule.id || null,
      needsApproval: action === "ask" || action === "unknown_needs_review",
      clarifyingQuestion: DISCOVERY_CLARIFYING_QUESTIONS[detected] || null,
      source: "rule",
    };
  }

  const probeText = `${normalizedPath} ${operationalPath} ${fileName}`;
  for (const entry of CLASSIFIER_PATTERNS) {
    if (!entry.pattern.test(probeText)) continue;
    return {
      folderPath: normalizedPath,
      operationalPath,
      detectedReportType: entry.type,
      vaultReportType: resolveVaultReportType(entry.type),
      action: entry.action,
      recommendedAction: entry.action,
      confidence: entry.confidence,
      reason: entry.reason,
      ruleId: null,
      needsApproval: entry.action === "ask" || entry.action === "unknown_needs_review",
      clarifyingQuestion: DISCOVERY_CLARIFYING_QUESTIONS[entry.type] || null,
      source: "classifier",
    };
  }

  return {
    folderPath: normalizedPath,
    operationalPath,
    detectedReportType: "unknown_needs_review",
    vaultReportType: null,
    action: "unknown_needs_review",
    recommendedAction: "unknown_needs_review",
    confidence: 0.35,
    reason: "No matching rule or classifier pattern — admin approval required.",
    ruleId: null,
    needsApproval: true,
    clarifyingQuestion: null,
    source: "unknown",
  };
}

export function shouldIngestDiscoveryDecision(decision) {
  if (!decision) return false;
  if (decision.action === "ignore") return false;
  if (decision.action === "ask" || decision.action === "unknown_needs_review") return false;
  if (decision.detectedReportType === "ignore") return false;
  return decision.action === "ingest" && Boolean(decision.vaultReportType);
}

export function groupFilesByOperationalFolder(files = []) {
  const groups = new Map();
  for (const file of files || []) {
    const folderPath = normalizeDrivePath(file.folderPath || file.relativePath || "");
    const operationalPath = extractOperationalFolderPath(folderPath, file.name);
    const key = operationalPath || folderPath || file.name;
    if (!groups.has(key)) {
      groups.set(key, { folderPath: key, files: [] });
    }
    groups.get(key).files.push(file);
  }
  return [...groups.values()];
}

export function buildDiscoverySummary(classifications = []) {
  const summary = {
    discoveredFolders: classifications.length,
    needsApprovalCount: 0,
    ignoredCount: 0,
    approvedIngestCount: 0,
    askCount: 0,
    unknownCount: 0,
    items: classifications,
  };
  for (const item of classifications) {
    if (item.recommendedAction === "ignore" || item.detectedReportType === "ignore") summary.ignoredCount += 1;
    else if (item.recommendedAction === "ingest" && !item.needsApproval) summary.approvedIngestCount += 1;
    else if (item.recommendedAction === "ask") summary.askCount += 1;
    else if (item.recommendedAction === "unknown_needs_review") summary.unknownCount += 1;
    if (item.needsApproval) summary.needsApprovalCount += 1;
  }
  return summary;
}
