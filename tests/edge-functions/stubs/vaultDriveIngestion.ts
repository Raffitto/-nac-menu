// Offline stand-in for supabase/functions/_shared/vaultDriveIngestion.ts (records privileged work).
import { state, table } from "./state.ts";
export type DriveFolder = Record<string, any>;

export async function createDriveIngestionRun(_admin: unknown, opts: { folder: DriveFolder; triggerType: string }) {
  const runId = `run-${++state.seq}`;
  table("ask_nac_drive_sync_runs").push({ id: runId, folder_id: opts.folder.id, trigger_type: opts.triggerType, stats: {} });
  state.createdRuns.push({
    runId,
    folderId: opts.folder.id,
    branchId: opts.folder.branch_id || opts.folder.default_branch_id || null,
    triggerType: opts.triggerType,
  });
  return runId;
}
export async function fetchDriveRunStatus(_admin: unknown, runId: string, _email: string) {
  const run = table("ask_nac_drive_sync_runs").find((r) => r.id === runId);
  return run ? { run: { ...run } } : null;
}
export async function processDriveIngestionRun(_admin: unknown, opts: { folder: DriveFolder; runId: string; email: string }) {
  state.processedRuns.push({ runId: opts.runId, folderId: opts.folder.id, email: opts.email });
  return { ok: true };
}
export async function verifyDriveFolderAccess(_accessToken: string, folderId: string) {
  return { id: folderId, name: `Folder ${folderId}`, mimeType: "application/vnd.google-apps.folder" };
}
export async function searchDriveFiles(accessToken: string, _query: string, _pageToken?: string) {
  return { files: [...(state.driveFiles[accessToken] || [])], nextPageToken: undefined };
}
export async function getDriveFile(accessToken: string, driveFileId: string) {
  const file = (state.driveFiles[accessToken] || []).find((f) => f.id === driveFileId);
  if (!file) throw new Error("offline stub: Drive file not found");
  return file;
}
export async function walkDriveFolderTree() {
  return { files: [], foldersScanned: 0, maxDepth: 0, truncated: false, duplicateCount: 0 };
}
