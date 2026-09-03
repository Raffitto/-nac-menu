/**
 * Smart Drive Discovery — Edge mirror of client classifier.
 */

export const DISCOVERY_TO_VAULT_REPORT_TYPE: Record<string, string | null> = {
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

const CLASSIFIER_PATTERNS: Array<{ pattern: RegExp; type: string; action: string; confidence: number; reason: string }> = [
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
    reason: "Discount / void / comp folder.",
  },
  { pattern: /\bguest feedback\b/i, type: "guest_feedback", action: "ask", confidence: 0.72, reason: "Guest Feedback purpose may vary." },
  { pattern: /\bweekly dashboards?\b|\bexecutive reports?\b.*\bweekly\b/i, type: "weekly_dashboard", action: "ingest", confidence: 0.96, reason: "Executive weekly dashboard folder." },
  { pattern: /\bhaccp\b/i, type: "food_safety_haccp", action: "ingest", confidence: 0.95, reason: "HACCP / food safety manual folder." },
  { pattern: /\btemperature log\b|\btemp(?:erature)?\s+monitor/i, type: "food_safety_temperature", action: "ingest", confidence: 0.94, reason: "Temperature monitoring folder." },
  { pattern: /\breceiving\b/i, type: "food_safety_receiving", action: "ingest", confidence: 0.93, reason: "Receiving checklist folder." },
  { pattern: /\bwaste\b|\bspoilage\b/i, type: "waste_report", action: "ingest", confidence: 0.92, reason: "Waste / spoilage reporting folder." },
  { pattern: /\bsupplier evaluation\b/i, type: "supplier_evaluation", action: "ingest", confidence: 0.91, reason: "Supplier evaluation folder." },
  { pattern: /\bdaily napkins count\b|\bnapkins count\b/i, type: "ignore", action: "ignore", confidence: 0.99, reason: "Excluded Daily Napkins Count folder." },
  { pattern: /\bmonthly cash safe\b/i, type: "ignore", action: "ignore", confidence: 0.99, reason: "Excluded Monthly Cash Safe folder." },
];

export function normalizeDrivePath(path = "") {
  return String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function patternSpecificity(pattern = "") {
  return String(pattern || "").length;
}

export function matchDiscoveryRule(folderPath = "", fileName = "", rules: Record<string, unknown>[] = [], branchId: string | null = null) {
  const normalizedPath = normalizeDrivePath(folderPath);
  const normalizedName = String(fileName || "").trim();
  const scoped = (rules || []).filter((rule) => rule?.active !== false);
  const branchScoped = scoped.filter((rule) => !rule.branch_id || !branchId || rule.branch_id === branchId);
  const sorted = [...branchScoped].sort(
    (a, b) => patternSpecificity(String(b.folder_path_pattern || "")) - patternSpecificity(String(a.folder_path_pattern || "")),
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

export function classifyDrivePath(folderPath = "", fileName = "", rules: Record<string, unknown>[] = [], branchId: string | null = null) {
  const normalizedPath = normalizeDrivePath(folderPath);
  const matchedRule = matchDiscoveryRule(normalizedPath, fileName, rules, branchId);

  if (matchedRule) {
    const detected = String(matchedRule.detected_report_type || "unknown_needs_review");
    const action = String(matchedRule.action || "unknown_needs_review");
    return {
      folderPath: normalizedPath,
      detectedReportType: detected,
      vaultReportType: DISCOVERY_TO_VAULT_REPORT_TYPE[detected] || null,
      action,
      recommendedAction: action,
      confidence: Number(matchedRule.confidence) || 0.8,
      reason: String(matchedRule.reason || `Matched rule: ${matchedRule.folder_path_pattern}`),
      needsApproval: action === "ask" || action === "unknown_needs_review",
    };
  }

  const probeText = `${normalizedPath} ${fileName}`;
  for (const entry of CLASSIFIER_PATTERNS) {
    if (!entry.pattern.test(probeText)) continue;
    return {
      folderPath: normalizedPath,
      detectedReportType: entry.type,
      vaultReportType: DISCOVERY_TO_VAULT_REPORT_TYPE[entry.type] || null,
      action: entry.action,
      recommendedAction: entry.action,
      confidence: entry.confidence,
      reason: entry.reason,
      needsApproval: entry.action === "ask" || entry.action === "unknown_needs_review",
    };
  }

  return {
    folderPath: normalizedPath,
    detectedReportType: "unknown_needs_review",
    vaultReportType: null,
    action: "unknown_needs_review",
    recommendedAction: "unknown_needs_review",
    confidence: 0.35,
    reason: "No matching rule or classifier pattern.",
    needsApproval: true,
  };
}

export function shouldIngestDiscoveryDecision(decision: { action?: string; detectedReportType?: string; vaultReportType?: string | null } | null) {
  if (!decision) return false;
  if (decision.action === "ignore" || decision.detectedReportType === "ignore") return false;
  if (decision.action === "ask" || decision.action === "unknown_needs_review") return false;
  return decision.action === "ingest" && Boolean(decision.vaultReportType);
}

export async function fetchActiveDiscoveryRules(admin: { from: (table: string) => any }, branchId: string | null = null) {
  let query = admin.from("ask_nac_drive_discovery_rules").select("*").eq("active", true);
  if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export function groupFilesByOperationalFolder(files: Array<{ folderPath?: string; relativePath?: string; name?: string }> = []) {
  const groups = new Map<string, { folderPath: string; files: typeof files }>();
  for (const file of files || []) {
    const normalizedPath = normalizeDrivePath(file.folderPath || file.relativePath || "");
    const parts = normalizedPath.split("/");
    const key = parts.length >= 2 ? parts.slice(0, 2).join("/") : normalizedPath || String(file.name || "");
    if (!groups.has(key)) groups.set(key, { folderPath: key, files: [] });
    groups.get(key)!.files.push(file);
  }
  return [...groups.values()];
}

export function buildDiscoverySummary(classifications: Array<{ recommendedAction?: string; detectedReportType?: string; needsApproval?: boolean }> = []) {
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
