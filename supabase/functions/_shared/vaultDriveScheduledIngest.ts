/**
 * Scheduled Google Drive folder ingestion — backend-only, no UI.
 * Invoked by vault-drive-sync action scheduled_ingest (Phase 1 / 2b).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  createDriveIngestionRun,
  processDriveIngestionRun,
  type DriveFolder,
} from "./vaultDriveIngestion.ts";

/** Stop before Supabase worker kill (~80s). Leave headroom for JSON response. */
export const SCHEDULED_INGEST_BUDGET_MS = 50_000;
export const SCHEDULED_BUDGET_RESERVE_MS = 3_000;
/** One process loop per folder keeps the worker under the Edge timeout; remaining files continue next night. */
export const SCHEDULED_MAX_LOOP_ATTEMPTS = 1;
export const SCHEDULED_MAX_FILES_DEFAULT = 25;
export const SCHEDULED_STUCK_RUN_MINUTES = 15;
/** Nightly job only guarantees these registered report types (folder IDs stay authoritative). */
export const SCHEDULED_PRIORITY_REPORT_TYPES = ["cash_up", "daily_logbook"] as const;

const REPORT_TYPE_PRIORITY: Record<string, number> = {
  cash_up: 0,
  daily_logbook: 1,
};

export type ScheduledIngestFolderResult = {
  folderId: string;
  driveFolderId: string;
  label: string;
  reportType: string;
  runId: string | null;
  status: string;
  partial: boolean;
  remainingFiles: number;
  loopAttempts: number;
  error: string | null;
  reason: string | null;
  discovered: number;
  newFiles: number;
  changedFiles: number;
  skippedFiles: number;
  ingestedFiles: number;
  failedFiles: number;
};

export type ScheduledIngestSummary = {
  foldersChecked: number;
  foldersProcessed: number;
  runsCreated: number;
  filesDiscovered: number;
  newFiles: number;
  changedFiles: number;
  skippedFiles: number;
  ingestedFiles: number;
  failedFiles: number;
  durationMs: number;
  partial: boolean;
  reason: string | null;
  stuckRunsCleaned: number;
  folderResults: ScheduledIngestFolderResult[];
};

export type ScheduledIngestOptions = {
  reportType?: string;
  /** When set, only these report types are eligible (default: cash_up + daily_logbook). */
  reportTypes?: string[];
  maxFolders?: number;
  maxFilesPerRun?: number;
  /** @deprecated use maxFilesPerRun */
  maxFilesToProcess?: number;
  budgetMs?: number;
  refreshAccessToken?: (refreshToken: string) => Promise<{ access_token: string; expires_in?: number }>;
};

type SupabaseAdmin = SupabaseClient;

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function scheduledFolderPriority(reportType: string): number {
  return REPORT_TYPE_PRIORITY[reportType] ?? 99;
}

export function sortScheduledFolders<T extends { report_type?: string | null; label?: string | null; folder_name?: string | null }>(
  folders: T[],
): T[] {
  return [...folders].sort((a, b) => {
    const pa = scheduledFolderPriority(String(a.report_type || ""));
    const pb = scheduledFolderPriority(String(b.report_type || ""));
    if (pa !== pb) return pa - pb;
    const la = String(a.label || a.folder_name || "");
    const lb = String(b.label || b.folder_name || "");
    return la.localeCompare(lb);
  });
}

export function filterScheduledFolders<T extends { report_type?: string | null }>(
  folders: T[],
  reportType?: string,
  reportTypes?: string[],
): T[] {
  const multi = Array.isArray(reportTypes)
    ? reportTypes.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (multi.length) {
    const allowed = new Set(multi);
    return folders.filter((row) => allowed.has(String(row.report_type || "")));
  }
  const filter = String(reportType || "").trim();
  if (!filter) return folders;
  return folders.filter((row) => String(row.report_type || "") === filter);
}

export function resolveScheduledIngestLimits(options: ScheduledIngestOptions = {}) {
  const budgetMs = Number(options.budgetMs)
    || Number(Deno.env.get("DRIVE_SCHEDULED_BUDGET_MS"))
    || SCHEDULED_INGEST_BUDGET_MS;
  const maxFilesPerRun = Number(options.maxFilesPerRun ?? options.maxFilesToProcess)
    || Number(Deno.env.get("DRIVE_SCHEDULED_MAX_FILES_TO_PROCESS"))
    || SCHEDULED_MAX_FILES_DEFAULT;
  const maxFolders = Number(options.maxFolders) > 0 ? Number(options.maxFolders) : null;
  const reportTypes = Array.isArray(options.reportTypes) && options.reportTypes.length
    ? options.reportTypes
    : [...SCHEDULED_PRIORITY_REPORT_TYPES];
  return {
    budgetMs,
    maxFilesPerRun,
    maxFolders,
    reportType: options.reportType,
    reportTypes: options.reportType ? undefined : reportTypes,
  };
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

function budgetRemainingMs(startedAt: number, budgetMs: number): number {
  return budgetMs - (Date.now() - startedAt);
}

function budgetExhausted(startedAt: number, budgetMs: number): boolean {
  return budgetRemainingMs(startedAt, budgetMs) <= SCHEDULED_BUDGET_RESERVE_MS;
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

async function loadRunRow(admin: SupabaseAdmin, runId: string) {
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
    stats,
  };
}

export async function cleanupStuckScheduledRuns(
  admin: SupabaseAdmin,
  {
    stuckMinutes = SCHEDULED_STUCK_RUN_MINUTES,
    now = Date.now(),
  }: { stuckMinutes?: number; now?: number } = {},
): Promise<number> {
  const cutoff = new Date(now - stuckMinutes * 60 * 1000).toISOString();
  // Reconcile both scheduled and manual runs stuck in running/queued so nightly jobs cannot pile up.
  const { data: stuck, error } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("id, stats, trigger_type, status")
    .in("status", ["running", "queued"])
    .lt("created_at", cutoff);

  if (error) throw new Error(error.message);
  if (!stuck?.length) return 0;

  const finishedAt = new Date(now).toISOString();
  for (const row of stuck) {
    const stats = (row.stats as Record<string, unknown>) || {};
    const scheduled = String(row.trigger_type || "") === "scheduled";
    const { error: updateError } = await admin
      .from("ask_nac_drive_sync_runs")
      .update({
        status: "partial",
        runtime_stage: "stale_run_reconciled",
        finished_at: finishedAt,
        completed_at: finishedAt,
        updated_at: finishedAt,
        current_file: null,
        stats: {
          ...stats,
          scheduledIngest: scheduled,
          scheduledStopReason: "scheduled_worker_aborted",
          runtimeStage: "stale_run_reconciled",
          staleRunReconciled: true,
        },
      })
      .eq("id", row.id)
      .in("status", ["running", "queued"]);
    if (updateError) throw new Error(updateError.message);
  }

  return stuck.length;
}

async function folderHasActiveIngestionRun(
  admin: SupabaseAdmin,
  folderId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("id")
    .eq("folder_id", folderId)
    .in("status", ["running", "queued"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function finalizeScheduledRunStop(
  admin: SupabaseAdmin,
  runId: string,
  reason: string,
  counters: ReturnType<typeof countersFromRun>,
) {
  const finishedAt = new Date().toISOString();
  const status = counters.status === "failed" ? "failed" : "partial";
  const { error } = await admin
    .from("ask_nac_drive_sync_runs")
    .update({
      status,
      finished_at: finishedAt,
      updated_at: finishedAt,
      current_file: null,
      stats: {
        ...counters.stats,
        scheduledIngest: true,
        scheduledStopReason: reason,
        remainingFiles: counters.remainingFiles,
        runtimeStage: status,
      },
    })
    .eq("id", runId);
  if (error) throw new Error(error.message);
  return status;
}

function emptyFolderResult(
  folder: Record<string, unknown>,
  patch: Partial<ScheduledIngestFolderResult> = {},
): ScheduledIngestFolderResult {
  return {
    folderId: String(folder.id),
    driveFolderId: String(folder.drive_folder_id || ""),
    label: String(folder.label || folder.folder_name || folder.drive_folder_id || ""),
    reportType: String(folder.report_type || ""),
    runId: null,
    status: "skipped",
    partial: false,
    remainingFiles: 0,
    loopAttempts: 0,
    error: null,
    reason: null,
    discovered: 0,
    newFiles: 0,
    changedFiles: 0,
    skippedFiles: 0,
    ingestedFiles: 0,
    failedFiles: 0,
    ...patch,
  };
}

function appendFolderCounters(
  summary: ScheduledIngestSummary,
  folderResult: ScheduledIngestFolderResult,
) {
  summary.filesDiscovered += folderResult.discovered;
  summary.newFiles += folderResult.newFiles;
  summary.changedFiles += folderResult.changedFiles;
  summary.skippedFiles += folderResult.skippedFiles;
  summary.ingestedFiles += folderResult.ingestedFiles;
  summary.failedFiles += folderResult.failedFiles;
}

export async function runScheduledDriveIngestion(
  admin: SupabaseAdmin,
  options: ScheduledIngestOptions = {},
): Promise<ScheduledIngestSummary> {
  const startedAt = Date.now();
  const {
    refreshAccessToken = refreshGoogleAccessToken,
    reportType,
    reportTypes,
    maxFolders,
    maxFilesPerRun,
    budgetMs,
  } = resolveScheduledIngestLimits(options);

  const summary: ScheduledIngestSummary = {
    foldersChecked: 0,
    foldersProcessed: 0,
    runsCreated: 0,
    filesDiscovered: 0,
    newFiles: 0,
    changedFiles: 0,
    skippedFiles: 0,
    ingestedFiles: 0,
    failedFiles: 0,
    durationMs: 0,
    partial: false,
    reason: null,
    stuckRunsCleaned: 0,
    folderResults: [],
  };

  summary.stuckRunsCleaned = await cleanupStuckScheduledRuns(admin);

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

  const eligible = sortScheduledFolders(
    filterScheduledFolders(folders || [], reportType, reportTypes),
  );
  summary.foldersChecked = eligible.length;

  const foldersToProcess = maxFolders ? eligible.slice(0, maxFolders) : eligible;
  let foldersProcessed = 0;

  for (const folderRow of foldersToProcess) {
    if (budgetExhausted(startedAt, budgetMs)) {
      summary.partial = true;
      summary.reason = summary.reason || "time_budget_exhausted";
      summary.folderResults.push(emptyFolderResult(folderRow, {
        status: "skipped",
        partial: true,
        reason: "time_budget_exhausted",
        error: "Scheduled ingest time budget exhausted before this folder could run.",
      }));
      continue;
    }

    const folder = folderRow as DriveFolder & Record<string, unknown>;
    let folderResult = emptyFolderResult(folderRow);
    foldersProcessed += 1;

    if (await folderHasActiveIngestionRun(admin, String(folder.id))) {
      folderResult = emptyFolderResult(folderRow, {
        status: "skipped",
        reason: "concurrency_lock",
        error: "An ingestion run is already active for this folder; skipped to avoid double-ingest.",
      });
      summary.folderResults.push(folderResult);
      continue;
    }

    const { data: connection } = await admin
      .from("ask_nac_drive_connections")
      .select("id,user_email,refresh_token,token_expires_at,status")
      .eq("id", folder.connection_id)
      .maybeSingle();

    if (!connection?.refresh_token) {
      folderResult = emptyFolderResult(folderRow, {
        status: "failed",
        error: "Drive connection not found or refresh token missing. Reconnect Google Drive.",
        reason: "connection_required",
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
      if (budgetExhausted(startedAt, budgetMs)) {
        summary.partial = true;
        summary.reason = summary.reason || "time_budget_exhausted";
        folderResult = emptyFolderResult(folderRow, {
          status: "skipped",
          partial: true,
          reason: "time_budget_exhausted",
          error: "Scheduled ingest time budget exhausted after token refresh.",
        });
        summary.folderResults.push(folderResult);
        continue;
      }

      await admin
        .from("ask_nac_drive_connections")
        .update({
          access_token: tokens.access_token,
          token_expires_at: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : connection.token_expires_at,
          status: "active",
          last_error: null,
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

      let loopAttempts = 0;
      let latestCounters = countersFromRun(null);
      let stopReason: string | null = null;

      while (loopAttempts < SCHEDULED_MAX_LOOP_ATTEMPTS && !budgetExhausted(startedAt, budgetMs)) {
        loopAttempts += 1;
        await processDriveIngestionRun(admin, {
          accessToken: tokens.access_token,
          folder,
          runId,
          email,
          maxFilesToProcess: maxFilesPerRun,
        });

        const run = await loadRunRow(admin, runId);
        latestCounters = countersFromRun(run);
        folderResult.status = latestCounters.status;

        if (
          latestCounters.remainingFiles <= 0
          || latestCounters.status === "completed"
          || latestCounters.status === "completed_empty"
        ) {
          break;
        }

        stopReason = "remaining_files";
        break;
      }

      if (budgetExhausted(startedAt, budgetMs) && latestCounters.status === "running") {
        stopReason = stopReason || "time_budget_exhausted";
      }

      if (
        latestCounters.status === "running"
        || (latestCounters.remainingFiles > 0 && latestCounters.status === "partial")
        || stopReason === "time_budget_exhausted"
      ) {
        const finalizeReason = stopReason
          || (latestCounters.remainingFiles > 0 ? "remaining_files" : "time_budget_exhausted");
        folderResult.partial = true;
        folderResult.reason = finalizeReason;
        summary.partial = true;
        summary.reason = summary.reason || finalizeReason;
        folderResult.status = await finalizeScheduledRunStop(admin, runId, finalizeReason, latestCounters);
      }

      folderResult.loopAttempts = loopAttempts;
      folderResult.discovered = latestCounters.discovered;
      folderResult.newFiles = latestCounters.newFiles;
      folderResult.changedFiles = latestCounters.changedFiles;
      folderResult.skippedFiles = latestCounters.skippedFiles;
      folderResult.ingestedFiles = latestCounters.ingestedFiles;
      folderResult.failedFiles = latestCounters.failedFiles;
      folderResult.remainingFiles = latestCounters.remainingFiles;

      appendFolderCounters(summary, folderResult);
    } catch (err) {
      const message = (err as Error)?.message || String(err);
      const concurrency = /already (running|queued)|double-ingest/i.test(message);
      const reconnectRequired = !concurrency
        && /invalid_grant|Bad Request|revoked|expired|refresh/i.test(message);
      if (concurrency) {
        folderResult = emptyFolderResult(folderRow, {
          status: "skipped",
          reason: "concurrency_lock",
          error: message,
        });
      } else {
        folderResult.status = "failed";
        folderResult.error = reconnectRequired
          ? "Google Drive authorization expired. Reconnect required."
          : message;
        folderResult.reason = reconnectRequired ? "connection_required" : "scheduled_processing_error";
        if (reconnectRequired && connection?.id) {
          await admin
            .from("ask_nac_drive_connections")
            .update({
              status: "reconnect_required",
              last_error: message.slice(0, 500),
              updated_at: new Date().toISOString(),
            })
            .eq("id", connection.id);
        }
        if (folderResult.runId) {
          const run = await loadRunRow(admin, folderResult.runId);
          const counters = countersFromRun(run);
          if (counters.status === "running") {
            await finalizeScheduledRunStop(admin, folderResult.runId, folderResult.reason, counters);
          }
        }
      }
    }

    summary.folderResults.push(folderResult);

    if (budgetExhausted(startedAt, budgetMs)) {
      summary.partial = true;
      summary.reason = summary.reason || "time_budget_exhausted";
      break;
    }
  }

  if (maxFolders && eligible.length > maxFolders) {
    summary.partial = true;
    summary.reason = summary.reason || "max_folders_limit";
  }

  summary.foldersProcessed = foldersProcessed;
  summary.durationMs = Date.now() - startedAt;
  return summary;
}
