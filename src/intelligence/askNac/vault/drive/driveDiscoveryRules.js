/**
 * Drive discovery rules persistence + candidate tracking.
 */
import {
  buildDiscoverySummary,
  classifyDrivePath,
  groupFilesByOperationalFolder,
  normalizeDrivePath,
} from "./driveDiscoveryClassifier";

export async function fetchActiveDiscoveryRules(supabase, { branchId = null } = {}) {
  let query = supabase
    .from("ask_nac_drive_discovery_rules")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertDiscoveryRules(supabase, rules = [], { createdBy = "admin", branchId = null } = {}) {
  const rows = [];
  for (const rule of rules || []) {
    if (!rule?.folderPathPattern) continue;
    const payload = {
      folder_path_pattern: rule.folderPathPattern,
      file_name_pattern: rule.fileNamePattern || null,
      detected_report_type: rule.detectedReportType,
      action: rule.action,
      branch_id: rule.branchId ?? branchId ?? null,
      confidence: rule.confidence ?? 0.9,
      reason: rule.reason || null,
      created_by: rule.createdBy || createdBy,
      active: rule.active !== false,
      updated_at: new Date().toISOString(),
    };

    let existingQuery = supabase
      .from("ask_nac_drive_discovery_rules")
      .select("id")
      .eq("folder_path_pattern", payload.folder_path_pattern);
    if (payload.branch_id) existingQuery = existingQuery.eq("branch_id", payload.branch_id);
    else existingQuery = existingQuery.is("branch_id", null);
    const { data: existing } = await existingQuery.maybeSingle();

    const write = existing?.id
      ? supabase.from("ask_nac_drive_discovery_rules").update(payload).eq("id", existing.id).select("*").single()
      : supabase.from("ask_nac_drive_discovery_rules").insert(payload).select("*").single();
    const { data, error } = await write;
    if (error) throw error;
    rows.push(data);
  }
  return rows;
}

export async function upsertDiscoveryCandidates(
  supabase,
  candidates = [],
  { connectionId = null, rootFolderId = null, branchId = null } = {},
) {
  const rows = [];
  for (const candidate of candidates || []) {
    if (!candidate?.folderPath) continue;
    const payload = {
      connection_id: connectionId,
      discovery_root_folder_id: rootFolderId,
      folder_path: normalizeDrivePath(candidate.folderPath),
      detected_report_type: candidate.detectedReportType,
      recommended_action: candidate.recommendedAction,
      confidence: candidate.confidence ?? 0.5,
      reason: candidate.reason || null,
      sample_filenames: candidate.sampleFilenames || [],
      file_count: candidate.fileCount || 0,
      branch_id: branchId || null,
      status: candidate.needsApproval ? "pending" : candidate.recommendedAction === "ignore" ? "ignored" : "approved",
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("ask_nac_drive_discovery_candidates")
      .upsert(payload, { onConflict: "discovery_root_folder_id,folder_path" })
      .select("*")
      .single();
    if (error) throw error;
    rows.push(data);
  }
  return rows;
}

export function classifyDiscoveredFolders(files = [], rules = [], branchId = null) {
  const groups = groupFilesByOperationalFolder(files);
  const classifications = groups.map((group) => {
    const sampleFilenames = group.files.slice(0, 5).map((file) => file.name).filter(Boolean);
    const decision = classifyDrivePath(group.folderPath, sampleFilenames[0] || "", rules, branchId);
    return {
      ...decision,
      sampleFilenames,
      fileCount: group.files.length,
    };
  });
  return {
    classifications,
    summary: buildDiscoverySummary(classifications),
  };
}

export async function fetchPendingDiscoveryCandidates(supabase, { branchId = null } = {}) {
  let query = supabase
    .from("ask_nac_drive_discovery_candidates")
    .select("*")
    .eq("status", "pending")
    .order("folder_path", { ascending: true });
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export function formatDiscoveryCandidateLines(classifications = []) {
  return classifications.map((item) => {
    const samples = (item.sampleFilenames || []).slice(0, 3).join(", ") || "—";
    const action = item.recommendedAction || item.action;
    return [
      `• ${item.operationalPath || item.folderPath}`,
      `  type: ${item.detectedReportType} (${Math.round((item.confidence || 0) * 100)}% confidence)`,
      `  action: ${action}${item.needsApproval ? " — needs approval" : ""}`,
      `  reason: ${item.reason}`,
      `  samples: ${samples}`,
    ].join("\n");
  });
}

export function formatDiscoverySummaryAnswer(summary = {}, { branchLabel = "Network" } = {}) {
  const lines = [
    `Drive discovery for ${branchLabel}:`,
    `• Discovered folders: ${summary.discoveredFolders || 0}`,
    `• Approved ingest: ${summary.approvedIngestCount || 0}`,
    `• Ignored: ${summary.ignoredCount || 0}`,
    `• Needs approval: ${summary.needsApprovalCount || 0}`,
    `• Ask later: ${summary.askCount || 0}`,
    `• Unknown: ${summary.unknownCount || 0}`,
  ];
  if (summary.items?.length) {
    lines.push("", "Folders/files:", ...formatDiscoveryCandidateLines(summary.items));
  }
  if (summary.needsApprovalCount > 0) {
    lines.push(
      "",
      "I found new folders/files. Should I ingest them?",
      "Reply naturally, e.g. “ingest Cash Up and Logbook”, “ignore Daily Napkins Count”, or “ask me about Guest Feedback later”.",
    );
  }
  return lines;
}
