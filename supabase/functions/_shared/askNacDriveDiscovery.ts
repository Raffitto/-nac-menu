/**
 * Edge parity — Drive discovery Ask NAC tools.
 */
import { branchDisplayName } from "./askNacFoodicsTools.ts";
import {
  buildDiscoverySummary,
  classifyDrivePath,
  fetchActiveDiscoveryRules,
} from "./driveDiscoveryClassifier.ts";

const CLARIFYING: Record<string, string> = {
  guest_feedback: "Is Guest Feedback operational feedback, customer complaints, or Google review tracking?",
  breakage_report: "Should Breakage be used for asset-loss reporting and staff accountability?",
  discount_void_comp: "Should Discount and comp be grouped with voids/discounts?",
};

const FOLDER_ALIASES: Array<{ pattern: RegExp; label: string; type: string }> = [
  { pattern: /\bcash[\s-]?up\b|\bcashup\b/i, label: "Cash Up", type: "cash_up" },
  { pattern: /\blog\s?book\b/i, label: "Logbook", type: "daily_logbook" },
  { pattern: /\bdaily reception\b|\breception\b/i, label: "Daily Reception", type: "daily_reception" },
  { pattern: /\bdaily briefing\b|\bbriefing\b/i, label: "Daily Briefing", type: "daily_briefing" },
  { pattern: /\bccm\b|\bfoodics\b/i, label: "CCM and Foodics", type: "ccm_reconciliation" },
  { pattern: /\bbreakage\b/i, label: "Breakage", type: "breakage_report" },
  { pattern: /\bdiscount and comp\b|\bdiscounts?\b|\bvoids?\b|\bcomp\b/i, label: "Discount and comp", type: "discount_void_comp" },
  { pattern: /\bguest feedback\b/i, label: "Guest Feedback", type: "guest_feedback" },
  { pattern: /\bweekly dashboards?\b/i, label: "Weekly Dashboards", type: "weekly_dashboard" },
  { pattern: /\bdaily napkins count\b|\bnapkins count\b/i, label: "Daily Napkins Count", type: "ignore" },
  { pattern: /\bmonthly cash safe\b/i, label: "Monthly Cash Safe", type: "ignore" },
];

function formatLines(summary: Record<string, unknown>, branchLabel: string) {
  const items = (summary.items as Record<string, unknown>[]) || [];
  const lines = [
    `Drive discovery for ${branchLabel}:`,
    `• Discovered folders: ${summary.discoveredFolders || 0}`,
    `• Approved ingest: ${summary.approvedIngestCount || 0}`,
    `• Ignored: ${summary.ignoredCount || 0}`,
    `• Needs approval: ${summary.needsApprovalCount || 0}`,
    `• Ask later: ${summary.askCount || 0}`,
    `• Unknown: ${summary.unknownCount || 0}`,
  ];
  for (const item of items) {
    const samples = ((item.sampleFilenames as string[]) || []).slice(0, 3).join(", ") || "—";
    lines.push(
      `• ${item.operationalPath || item.folderPath}`,
      `  type: ${item.detectedReportType} (${Math.round(Number(item.confidence || 0) * 100)}% confidence)`,
      `  action: ${item.recommendedAction}${item.needsApproval ? " — needs approval" : ""}`,
      `  reason: ${item.reason}`,
      `  samples: ${samples}`,
    );
  }
  if (Number(summary.needsApprovalCount || 0) > 0) {
    lines.push(
      "",
      "I found new folders/files. Should I ingest them?",
      "Reply naturally, e.g. “ingest Cash Up and Logbook”, “ignore Daily Napkins Count”, or “ask me about Guest Feedback later”.",
    );
  }
  return lines;
}

export async function discoverDriveFolders(supabase: any, context: Record<string, unknown> = {}) {
  const branchId = String(context.branch || context.scopedBranch || "") || null;
  const rules = await fetchActiveDiscoveryRules(supabase, branchId);
  let query = supabase.from("ask_nac_drive_discovery_candidates").select("*").order("folder_path", { ascending: true });
  if (branchId) query = query.eq("branch_id", branchId);
  const { data: candidates } = await query;

  const classifications = (candidates || []).map((row: Record<string, unknown>) => ({
    folderPath: row.folder_path,
    operationalPath: row.folder_path,
    detectedReportType: row.detected_report_type,
    recommendedAction: row.recommended_action,
    confidence: Number(row.confidence) || 0.5,
    reason: row.reason,
    sampleFilenames: row.sample_filenames || [],
    fileCount: row.file_count || 0,
    needsApproval: row.status === "pending",
    clarifyingQuestion: CLARIFYING[String(row.detected_report_type || "")] || null,
  }));

  const fallback = rules.map((rule: Record<string, unknown>) => ({
    folderPath: rule.folder_path_pattern,
    operationalPath: rule.folder_path_pattern,
    detectedReportType: rule.detected_report_type,
    recommendedAction: rule.action,
    confidence: Number(rule.confidence) || 0.8,
    reason: rule.reason || "Stored discovery rule.",
    sampleFilenames: [],
    needsApproval: rule.action === "ask",
  }));

  const items = classifications.length ? classifications : fallback;
  const summary = buildDiscoverySummary(items);
  const branchLabel = branchId ? branchDisplayName(branchId) : "Network";
  return {
    branch: branchId,
    branchLabel,
    summary,
    answerLines: formatLines(summary, branchLabel),
    sources: [{ name: "ask_nac_drive_discovery_rules", detail: "Smart Drive discovery classifier + approval rules" }],
  };
}

export function parseDriveDiscoveryApproval(question = "") {
  const text = String(question || "").trim();
  const ingest = /\b(ingest|include|approve|enable|sync|import|add|treat|classify|map|use|as)\b/i.test(text);
  const ignore = /\b(ignore|exclude|skip|never ingest|do not ingest|don't ingest|dont ingest)\b/i.test(text);
  const ask = /\b(ask me about|ask about|defer|later|hold)\b/i.test(text);
  const action = ignore ? "ignore" : ask ? "ask" : ingest ? "ingest" : "ingest";
  const decisions: Array<Record<string, unknown>> = [];
  for (const alias of FOLDER_ALIASES) {
    if (!alias.pattern.test(text)) continue;
    decisions.push({
      folderPathPattern: alias.label,
      detectedReportType: alias.type,
      action: alias.type === "ignore" ? "ignore" : action,
      confidence: 0.95,
      reason: `Approved via Ask NAC: "${text.slice(0, 180)}"`,
    });
  }
  return { raw: text, action, decisions };
}

export async function approveDriveDiscoveryRules(supabase: any, context: Record<string, unknown> = {}) {
  const parsed = parseDriveDiscoveryApproval(String(context.question || ""));
  if (!parsed.decisions.length) {
    return {
      ok: false,
      applied: [],
      answerLines: [
        "I couldn't map that approval to a Drive folder.",
        "Try: “ingest Cash Up and Logbook”, “ignore Daily Napkins Count”, or “treat Voids discounts as discount_void_comp”.",
      ],
    };
  }

  const branchId = String(context.branch || context.scopedBranch || "") || null;
  const applied = [];
  for (const decision of parsed.decisions) {
    const payload = {
      folder_path_pattern: decision.folderPathPattern,
      detected_report_type: decision.detectedReportType,
      action: decision.action,
      branch_id: branchId,
      confidence: decision.confidence,
      reason: decision.reason,
      created_by: String(context.userEmail || "admin"),
      active: true,
      updated_at: new Date().toISOString(),
    };
    let existingQuery = supabase.from("ask_nac_drive_discovery_rules").select("id").eq("folder_path_pattern", payload.folder_path_pattern);
    if (branchId) existingQuery = existingQuery.eq("branch_id", branchId);
    else existingQuery = existingQuery.is("branch_id", null);
    const { data: existing } = await existingQuery.maybeSingle();
    const write = existing?.id
      ? supabase.from("ask_nac_drive_discovery_rules").update(payload).eq("id", existing.id).select("*").single()
      : supabase.from("ask_nac_drive_discovery_rules").insert(payload).select("*").single();
    const { data } = await write;
    if (data) applied.push(data);
    await supabase
      .from("ask_nac_drive_discovery_candidates")
      .update({
        status: decision.action === "ignore" ? "ignored" : decision.action === "ask" ? "deferred" : "approved",
        reviewed_by: String(context.userEmail || "admin"),
        reviewed_at: new Date().toISOString(),
      })
      .ilike("folder_path", `%${decision.folderPathPattern}%`);
  }

  return {
    ok: true,
    applied,
    answerLines: [
      `Saved ${applied.length} Drive discovery rule(s).`,
      ...applied.map((rule: Record<string, unknown>) => `• ${rule.folder_path_pattern} → ${rule.detected_report_type} (${rule.action})`),
      "Future matching files under approved Daily/Weekly roots will ingest automatically on Sync & Ingest.",
    ],
    sources: [{ name: "ask_nac_drive_discovery_rules", detail: "Approval gate decisions persisted" }],
  };
}

export function isDriveDiscoveryCommand(question = "") {
  return /\bdiscover drive folders?\b/i.test(String(question || "").trim());
}

export function isDriveDiscoveryApprovalCommand(question = "") {
  const text = String(question || "").trim();
  if (/^approve drive ingestion rules\b/i.test(text)) return true;
  return FOLDER_ALIASES.some(({ pattern }) => pattern.test(text))
    && /\b(ingest|ignore|exclude|approve|never ingest|ask me about|treat|classify)\b/i.test(text);
}

export function scoreDriveDiscoveryIntent(question = "") {
  if (isDriveDiscoveryApprovalCommand(question)) return 46;
  if (isDriveDiscoveryCommand(question)) return 44;
  return 0;
}
