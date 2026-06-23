/**
 * Ask NAC Drive discovery + approval query tools.
 */
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import {
  classifyDiscoveredFolders,
  fetchActiveDiscoveryRules,
  formatDiscoverySummaryAnswer,
  upsertDiscoveryCandidates,
  upsertDiscoveryRules,
} from "./drive/driveDiscoveryRules";
import {
  isDriveDiscoveryApprovalCommand,
  isDriveDiscoveryCommand,
  parseDriveDiscoveryApprovalCommand,
} from "./drive/driveDiscoveryApprovalParser";
import { DISCOVERY_CLARIFYING_QUESTIONS } from "./drive/driveDiscoveryClassifier";

export { isDriveDiscoveryCommand, isDriveDiscoveryApprovalCommand };

export async function discoverDriveFoldersFromRules(supabase, context = {}) {
  const branchId = context.branch || context.scopedBranch || null;
  const rules = await fetchActiveDiscoveryRules(supabase, { branchId });

  const { data: roots, error: rootsError } = await supabase
    .from("ask_nac_drive_sync_folders")
    .select("id,folder_name,label,branch_id,is_discovery_root,enabled")
    .eq("is_discovery_root", true)
    .eq("enabled", true);
  if (rootsError) throw rootsError;

  const { data: pendingCandidates, error: pendingError } = await supabase
    .from("ask_nac_drive_discovery_candidates")
    .select("*")
    .eq("status", "pending")
    .order("folder_path", { ascending: true });
  if (pendingError) throw pendingError;

  let classifications = [];
  if (pendingCandidates?.length) {
    classifications = pendingCandidates.map((row) => ({
      folderPath: row.folder_path,
      operationalPath: row.folder_path,
      detectedReportType: row.detected_report_type,
      recommendedAction: row.recommended_action,
      confidence: Number(row.confidence) || 0.5,
      reason: row.reason,
      sampleFilenames: row.sample_filenames || [],
      fileCount: row.file_count || 0,
      needsApproval: row.status === "pending",
      clarifyingQuestion: DISCOVERY_CLARIFYING_QUESTIONS[row.detected_report_type] || null,
    }));
  } else if (context.discoveryFiles?.length) {
    const result = classifyDiscoveredFolders(context.discoveryFiles, rules, branchId);
    classifications = result.classifications;
  } else {
    classifications = rules
      .filter((rule) => rule.active)
      .map((rule) => ({
        folderPath: rule.folder_path_pattern,
        operationalPath: rule.folder_path_pattern,
        detectedReportType: rule.detected_report_type,
        recommendedAction: rule.action,
        confidence: Number(rule.confidence) || 0.8,
        reason: rule.reason || "Stored discovery rule.",
        sampleFilenames: [],
        fileCount: 0,
        needsApproval: rule.action === "ask",
        clarifyingQuestion: DISCOVERY_CLARIFYING_QUESTIONS[rule.detected_report_type] || null,
        source: "stored_rule",
      }));
  }

  const summary = {
    discoveredFolders: classifications.length,
    needsApprovalCount: classifications.filter((item) => item.needsApproval).length,
    ignoredCount: classifications.filter((item) => item.recommendedAction === "ignore").length,
    approvedIngestCount: classifications.filter((item) => item.recommendedAction === "ingest" && !item.needsApproval).length,
    askCount: classifications.filter((item) => item.recommendedAction === "ask").length,
    unknownCount: classifications.filter((item) => item.recommendedAction === "unknown_needs_review").length,
    items: classifications,
    discoveryRoots: roots || [],
    rulesLoaded: rules.length,
  };

  return {
    branch: branchId,
    branchLabel: branchId ? branchDisplayName(branchId) : "Network",
    summary,
    answerLines: formatDiscoverySummaryAnswer(summary, {
      branchLabel: branchId ? branchDisplayName(branchId) : "Network",
    }),
    sources: [{ name: "ask_nac_drive_discovery_rules", detail: "Smart Drive discovery classifier + approval rules" }],
  };
}

export async function approveDriveDiscoveryRules(supabase, context = {}) {
  const parsed = parseDriveDiscoveryApprovalCommand(context.question || "", {
    createdBy: context.userEmail || context.createdBy || "admin",
  });
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

  const branchId = context.branch || context.scopedBranch || null;
  const applied = await upsertDiscoveryRules(
    supabase,
    parsed.decisions.map((decision) => ({ ...decision, branchId })),
    { createdBy: context.userEmail || "admin", branchId },
  );

  for (const decision of parsed.decisions) {
    await supabase
      .from("ask_nac_drive_discovery_candidates")
      .update({
        status: decision.action === "ignore" ? "ignored" : decision.action === "ask" ? "deferred" : "approved",
        reviewed_by: context.userEmail || context.createdBy || "admin",
        reviewed_at: new Date().toISOString(),
      })
      .ilike("folder_path", `%${decision.folderPathPattern}%`);
  }

  return {
    ok: true,
    applied,
    parsed,
    answerLines: [
      `Saved ${applied.length} Drive discovery rule(s).`,
      ...applied.map(
        (rule) =>
          `• ${rule.folder_path_pattern} → ${rule.detected_report_type} (${rule.action})`,
      ),
      "Future matching files under approved Daily/Weekly roots will ingest automatically on Sync & Ingest.",
    ],
    sources: [{ name: "ask_nac_drive_discovery_rules", detail: "Approval gate decisions persisted" }],
  };
}

export async function recordDiscoveryScanResults(supabase, { items = [], rootFolderId = null, connectionId = null, branchId = null } = {}) {
  const candidates = (items || []).map((item) => ({
    folderPath: item.folderPath || item.operationalPath,
    detectedReportType: item.detectedReportType,
    recommendedAction: item.recommendedAction || item.action,
    confidence: item.confidence,
    reason: item.reason,
    sampleFilenames: item.sampleFilenames || [],
    fileCount: item.fileCount || 0,
    needsApproval: item.needsApproval,
  }));
  return upsertDiscoveryCandidates(supabase, candidates, { rootFolderId, connectionId, branchId });
}
