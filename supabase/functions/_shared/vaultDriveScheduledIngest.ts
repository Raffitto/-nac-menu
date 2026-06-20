/**
 * Scheduled Google Drive folder ingestion — backend-only, no UI.
 * Invoked by vault-drive-sync action scheduled_ingest (Phase 1).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createDriveIngestionRun,
  processDriveIngestionRun,
  type DriveFolder,
} from "./vaultDriveIngestion.ts";

const SCHEDULED_INGEST_TIMEOUT_MS = 110_000;
const SCHEDULED_MAX_LOOP_ATTEMPTS = 5;
const SCHEDULED_MAX_FILES_DEFAULT = 200;

export type ScheduledIngestFolderResult = {
  folderId: string;
  driveFolderId: string;
  label: string;
  runId: string | null;
  status: string;
  partial: boolean;
  remainingFiles: number;
  loopAttempts: number;
  error: string | null;
  discovered: number;
  newFiles: number;
  changedFiles: number;
  skippedFiles: number;
  ingestedFiles: number;
  failedFiles: number;
};

export type ScheduledIngestSummary = {
  foldersChecked: number;
  runsCreated: number;
  filesDiscovered: number;
  newFiles: number;
  changedFiles: number;
  skippedFiles: number;
  ingestedFiles: number;
  failedFiles: number;
  durationMs: number;
  partial: boolean;
  folderResults: ScheduledIngestFolderResult[];
};

type SupabaseAdmin = SupabaseClient;

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function isScheduledIngestSecretConfigured(): boolean {
  return Boolean(String(Deno.env.get("DRIVE_SCHEDULED_INGEST_SECRET") || "").trim());
}

export function validateScheduledIngestSecret(req: Request): boolean {
  const expected = String(Deno.env.get("DRIVE_SCHEDULED_INGEST_SECRET") || "").trim();
  if (!expected) return false;
  const token = extractBearerToken(req.headers.get("Authorization"));
  return Boolean(token && token === expected);
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(String(data.error_description || data.error || "Refresh failed"));
  }
  return data as { access_token: string; expires_in?: number };
}

async function loadRunCounters(admin: SupabaseAdmin, runId: string) {
  const { data: run, error } = await admin
    .from("ask_nac_drive_sync_runs")
    .select(
      "id,status,discovered_count,new_count,changed_count,skipped_count,downloaded_count,indexed_count,failed_count,stats",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return run as Record<string, unknown> | null;
}

function countersFromRun(run: Record<string, unknown> | null) {
  const stats = (run?.stats as Record<string, unknown>) || {};
  return {
    discovered: Number(run?.discovered_count ?? stats.discoveredFiles ?? 0) || 0,
    newFiles: Number(run?.new_count ?? 0) || 0,
    changedFiles: Number(run?.changed_count ?? 0) || 0,
    skippedFiles: Number(run?.skipped_count ?? 0) || 0,
    ingestedFiles: Number(run?.indexed_count ?? 0) || 0,
    failedFiles: Number(run?.failed_count ?? 0) || 0,
    remainingFiles: Number(stats.remainingFiles ?? 0) || 0,
    status: String(run?.status || "unknown"),
  };
}

function emptyFolderResult(
  folder: Record<string, unknown>,
  patch: Partial<ScheduledIngestFolderResult> = {},
): ScheduledIngestFolderResult {
  return {
    folderId: String(folder.id),
    driveFolderId: String(folder.drive_folder_id || ""),
    label: String(folder.label || folder.folder_name || folder.drive_folder_id || ""),
    runId: null,
    status: "skipped",
    partial: false,
    remainingFiles: 0,
    loopAttempts: 0,
    error: null,
    discovered: 0,
    newFiles: 0,
    changedFiles: 0,
    skippedFiles: 0,
    ingestedFiles: 0,
    failedFiles: 0,
    ...patch,
  };
}

export async function runScheduledDriveIngestion(
  admin: SupabaseAdmin,
  {
    refreshAccessToken = refreshGoogleAccessToken,
    maxFilesToProcess,
    timeoutMs = SCHEDULED_INGEST_TIMEOUT_MS,
  }: {
    refreshAccessToken?: (refreshToken: string) => Promise<{ access_token: string; expires_in?: number }>;
    maxFilesToProcess?: number;
    timeoutMs?: number;
  } = {},
): Promise<ScheduledIngestSummary> {
  const startedAt = Date.now();
  const initialMaxFiles = Number(maxFilesToProcess)
    || Number(Deno.env.get("DRIVE_SCHEDULED_MAX_FILES_TO_PROCESS"))
    || SCHEDULED_MAX_FILES_DEFAULT;

  const summary: ScheduledIngestSummary = {
    foldersChecked: 0,
    runsCreated: 0,
    filesDiscovered: 0,
    newFiles: 0,
    changedFiles: 0,
    skippedFiles: 0,
    ingestedFiles: 0,
    failedFiles: 0,
    durationMs: 0,
    partial: false,
    folderResults: [],
  };

  const { data: folders, error: folderError } = await admin
    .from("ask_nac_drive_sync_folders")
    .select(
      "id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,enabled,schedule",
    )
    .eq("enabled", true)
    .eq("auto_ingest", true)
    .eq("schedule", "daily")
    .not("drive_folder_id", "is", null);

  if (folderError) throw new Error(folderError.message);

  summary.foldersChecked = folders?.length || 0;

  for (const folderRow of folders || []) {
    if (Date.now() - startedAt >= timeoutMs) {
      summary.partial = true;
      summary.folderResults.push(emptyFolderResult(folderRow, {
        status: "timeout",
        error: "Scheduled ingest timeout budget exhausted before this folder could run.",
      }));
      continue;
    }

    const folder = folderRow as DriveFolder & Record<string, unknown>;
    let folderResult = emptyFolderResult(folderRow);

    const { data: connection } = await admin
      .from("ask_nac_drive_connections")
      .select("id,user_email,refresh_token,token_expires_at")
      .eq("id", folder.connection_id)
      .maybeSingle();

    if (!connection?.refresh_token) {
      folderResult = emptyFolderResult(folderRow, {
        status: "failed",
        error: "Drive connection not found or refresh token missing.",
      });
      summary.folderResults.push(folderResult);
      continue;
    }

    const email = String(connection.user_email || "").toLowerCase();
    if (!email) {
      folderResult = emptyFolderResult(folderRow, {
        status: "failed",
        error: "Drive connection is missing user_email.",
      });
      summary.folderResults.push(folderResult);
      continue;
    }

    try {
      const tokens = await refreshAccessToken(String(connection.refresh_token));
      await admin
        .from("ask_nac_drive_connections")
        .update({
          access_token: tokens.access_token,
          token_expires_at: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : connection.token_expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);

      const runId = await createDriveIngestionRun(admin, {
        folder,
        triggerType: "scheduled",
        initialStats: {
          runtimeStage: "scheduled_ingest_started",
          sourceTable: "ask_nac_drive_sync_folders",
          scheduledIngest: true,
        },
      });
      summary.runsCreated += 1;
      folderResult.runId = runId;

      let maxFiles = initialMaxFiles;
      let loopAttempts = 0;
      let latestCounters = countersFromRun(null);

      while (loopAttempts < SCHEDULED_MAX_LOOP_ATTEMPTS && Date.now() - startedAt < timeoutMs) {
        loopAttempts += 1;
        await processDriveIngestionRun(admin, {
          accessToken: tokens.access_token,
          folder,
          runId,
          email,
          maxFilesToProcess: maxFiles,
        });

        const run = await loadRunCounters(admin, runId);
        latestCounters = countersFromRun(run);
        folderResult.status = latestCounters.status;

        if (
          latestCounters.remainingFiles <= 0
          || latestCounters.status === "completed"
          || latestCounters.status === "completed_empty"
        ) {
          break;
        }

        folderResult.partial = true;
        summary.partial = true;
        maxFiles = latestCounters.discovered > 0
          ? latestCounters.discovered
          : maxFiles + latestCounters.remainingFiles;
      }

      if (latestCounters.remainingFiles > 0 && latestCounters.status === "partial") {
        folderResult.partial = true;
        summary.partial = true;
        folderResult.remainingFiles = latestCounters.remainingFiles;
      }

      folderResult.loopAttempts = loopAttempts;
      folderResult.discovered = latestCounters.discovered;
      folderResult.newFiles = latestCounters.newFiles;
      folderResult.changedFiles = latestCounters.changedFiles;
      folderResult.skippedFiles = latestCounters.skippedFiles;
      folderResult.ingestedFiles = latestCounters.ingestedFiles;
      folderResult.failedFiles = latestCounters.failedFiles;
      folderResult.remainingFiles = latestCounters.remainingFiles;

      summary.filesDiscovered += folderResult.discovered;
      summary.newFiles += folderResult.newFiles;
      summary.changedFiles += folderResult.changedFiles;
      summary.skippedFiles += folderResult.skippedFiles;
      summary.ingestedFiles += folderResult.ingestedFiles;
      summary.failedFiles += folderResult.failedFiles;
    } catch (err) {
      folderResult.status = "failed";
      folderResult.error = (err as Error)?.message || String(err);
    }

    summary.folderResults.push(folderResult);
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}
