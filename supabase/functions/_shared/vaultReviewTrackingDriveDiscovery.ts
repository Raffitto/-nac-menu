/**
 * Narrow Drive discovery for the operational "2026 review tracking" workbook.
 * Uses Drive name search instead of walking My Drive or Daily recursively.
 */

import { isReviewTrackingWorkbookName } from "./vaultReviewTrackingWorkbookParser.ts";
import {
  createDriveIngestionRun,
  getDriveFile,
  processDriveIngestionRun,
  searchDriveFiles,
  verifyDriveFolderAccess,
  type DriveFolder,
} from "./vaultDriveIngestion.ts";

type SupabaseLike = {
  from: (table: string) => any;
};

export type ReviewTrackingDriveHit = {
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  parentId: string | null;
  parentName: string | null;
  hostFolder: DriveFolder;
};

const SEARCH_QUERY = "name contains 'review tracking' and trashed = false";

export async function findReviewTrackingDriveFiles(accessToken: string) {
  const hits: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    parents?: string[];
  }> = [];
  let pageToken: string | undefined;
  do {
    const listing = await searchDriveFiles(accessToken, SEARCH_QUERY, pageToken);
    for (const file of listing.files || []) {
      if (isReviewTrackingWorkbookName(file.name)) hits.push(file);
    }
    pageToken = listing.nextPageToken;
  } while (pageToken);
  return hits;
}

async function loadKhobarConnectionFolder(
  admin: SupabaseLike,
  connectionId: string,
  driveFolderId: string,
): Promise<DriveFolder | null> {
  const { data } = await admin
    .from("ask_nac_drive_sync_folders")
    .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,enabled")
    .eq("connection_id", connectionId)
    .eq("drive_folder_id", driveFolderId)
    .maybeSingle();
  return data || null;
}

export async function ensureReviewTrackingHostFolder(
  admin: SupabaseLike,
  {
    connectionId,
    branchId = "khobar",
    parentId,
    parentName,
  }: {
    connectionId: string;
    branchId?: string;
    parentId: string | null;
    parentName: string | null;
  },
): Promise<DriveFolder> {
  if (parentId) {
    const existing = await loadKhobarConnectionFolder(admin, connectionId, parentId);
    if (existing) return existing;
    const parentLabel = String(parentName || "");
    const skipWalkParent = /^(my drive|root)$/i.test(parentLabel.trim());
    const dedicatedParent = !skipWalkParent && Boolean(parentId);
    if (dedicatedParent) {
      const { data, error } = await admin
        .from("ask_nac_drive_sync_folders")
        .upsert(
          {
            connection_id: connectionId,
            drive_folder_id: parentId,
            folder_name: parentName || "2026 review tracking",
            label: parentName || "2026 review tracking",
            default_branch_id: branchId,
            default_department: "reception",
            branch_id: branchId,
            department: "reception",
            report_type: "google_review_tracking",
            sensitivity: "internal",
            auto_ingest: true,
            is_discovery_root: false,
            schedule: "daily",
            enabled: true,
          },
          { onConflict: "connection_id,drive_folder_id" },
        )
        .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,enabled")
        .single();
      if (error) throw error;
      return data;
    }
  }

  const { data: existingTracking } = await admin
    .from("ask_nac_drive_sync_folders")
    .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,enabled")
    .eq("connection_id", connectionId)
    .eq("report_type", "google_review_tracking")
    .eq("enabled", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingTracking) return existingTracking;

  const { data: fallback } = await admin
    .from("ask_nac_drive_sync_folders")
    .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,enabled")
    .eq("connection_id", connectionId)
    .eq("enabled", true)
    .order("is_discovery_root", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!fallback) throw new Error("No registered Drive folder available to host review-tracking ingest.");
  return fallback;
}

export async function resolveReviewTrackingHits(
  admin: SupabaseLike,
  {
    accessToken,
    connectionId,
    branchId = "khobar",
  }: {
    accessToken: string;
    connectionId: string;
    branchId?: string;
  },
): Promise<ReviewTrackingDriveHit[]> {
  const files = await findReviewTrackingDriveFiles(accessToken);
  const hits: ReviewTrackingDriveHit[] = [];
  for (const file of files) {
    const parentId = file.parents?.[0] || null;
    let parentName: string | null = null;
    if (parentId) {
      try {
        const parent = await verifyDriveFolderAccess(accessToken, parentId);
        parentName = parent.name || null;
      } catch {
        parentName = null;
      }
    }
    const hostFolder = await ensureReviewTrackingHostFolder(admin, {
      connectionId,
      branchId,
      parentId,
      parentName,
    });
    hits.push({
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime || null,
      parentId,
      parentName,
      hostFolder,
    });
  }
  return hits;
}

export async function ingestConnectedReviewTracking(
  admin: SupabaseLike,
  {
    refreshAccessToken,
    triggerType = "manual",
    force = false,
    connectionId = null,
  }: {
    refreshAccessToken: (refreshToken: string) => Promise<{ access_token: string; expires_in?: number }>;
    triggerType?: string;
    force?: boolean;
    connectionId?: string | null;
  },
) {
  let query = admin
    .from("ask_nac_drive_connections")
    .select("id,user_email,refresh_token,status")
    .not("refresh_token", "is", null);
  if (connectionId) query = query.eq("id", connectionId);
  const { data: connections, error } = await query;
  if (error) throw error;
  const summaries = [];
  for (const connection of connections || []) {
    const tokens = await refreshAccessToken(String(connection.refresh_token));
    await admin.from("ask_nac_drive_connections").update({
      access_token: tokens.access_token,
      token_expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id);
    const hits = await resolveReviewTrackingHits(admin, {
      accessToken: tokens.access_token,
      connectionId: connection.id,
      branchId: "khobar",
    });
    const ingested = hits.length
      ? await ingestReviewTrackingHits(admin, {
        accessToken: tokens.access_token,
        email: String(connection.user_email || "").toLowerCase(),
        hits,
        triggerType,
        force,
      })
      : [];
    summaries.push({
      connectionId: connection.id,
      email: connection.user_email,
      discovered: hits.length,
      hits: hits.map((hit) => ({
        fileId: hit.fileId,
        fileName: hit.fileName,
        mimeType: hit.mimeType,
        parentId: hit.parentId,
        parentName: hit.parentName,
        hostFolderId: hit.hostFolder.id,
        hostFolderName: hit.hostFolder.folder_name || hit.hostFolder.label,
      })),
      ingested,
    });
  }
  return summaries;
}

export async function ingestReviewTrackingHits(
  admin: SupabaseLike,
  {
    accessToken,
    email,
    hits,
    triggerType = "manual",
    force = false,
  }: {
    accessToken: string;
    email: string;
    hits: ReviewTrackingDriveHit[];
    triggerType?: string;
    force?: boolean;
  },
) {
  const results = [];
  for (const hit of hits) {
    const driveFile = await getDriveFile(accessToken, hit.fileId);
    const runId = await createDriveIngestionRun(admin, {
      folder: hit.hostFolder,
      triggerType,
      initialStats: {
        runtimeStage: "queued",
        targetDriveFileId: hit.fileId,
        targetDriveFileName: hit.fileName,
        reviewTrackingDiscovery: true,
        parentFolderId: hit.parentId,
        parentFolderName: hit.parentName,
      },
    });
    await processDriveIngestionRun(admin, {
      accessToken,
      folder: hit.hostFolder,
      runId,
      email,
      onlyDriveFileId: hit.fileId,
      force,
      maxFilesToProcess: 1,
    });
    results.push({
      runId,
      fileId: hit.fileId,
      fileName: hit.fileName,
      parentId: hit.parentId,
      parentName: hit.parentName,
      hostFolderId: hit.hostFolder.id,
      mimeType: driveFile.mimeType,
    });
  }
  return results;
}
