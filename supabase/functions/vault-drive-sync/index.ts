/**
 * Google Drive sync Edge Function for Data Vault bulk ingestion.
 * Deploy: supabase functions deploy vault-drive-sync
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY
 *
 * SECURITY: OAuth tokens live only in ask_nac_drive_connections (service-role writes).
 * Never return, log, or forward access_token / refresh_token in responses or errors.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sanitizeErrorMessage } from "../_shared/vaultDriveSecrets.ts";
import {
  createDriveIngestionRun,
  fetchDriveRunStatus,
  processDriveIngestionRun,
} from "../_shared/vaultDriveIngestion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METADATA_ONLY_NOTE =
  "Drive sync completed as metadata-only. Enable folder auto-ingest or use Sync & Ingest Drive to ingest files.";

const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Exchange OAuth code — tokens stay server-side only. */
async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(sanitizeErrorMessage(data.error_description || data.error || "Token exchange failed"));
  }
  return data;
}

/** Refresh access token — never log or return the result to clients. */
async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(sanitizeErrorMessage(data.error_description || "Refresh failed"));
  return data;
}

/** List Drive file metadata only — no file downloads. */
async function listDriveFiles(accessToken: string, folderId: string, pageToken?: string) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(sanitizeErrorMessage(data.error?.message || "Drive list failed"));
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return json(500, { error: "Supabase env not configured" });

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Service role required for token storage and sync run writes — bypasses RLS safely.
    const admin = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey)
      : supabase;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.email) return json(401, { error: "Invalid session" });

    const userEmail = userData.user.email.toLowerCase();
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = String(body?.action || new URL(req.url).searchParams.get("action") || "status");

    const redirectUri =
      body?.redirectUri ||
      `${supabaseUrl}/functions/v1/vault-drive-sync?action=callback`;

    if (action === "authorize") {
      const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
      if (!clientId) return json(503, { error: "Google Drive not configured" });

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: DRIVE_SCOPES,
        access_type: "offline",
        prompt: "consent",
        state: userEmail,
      });

      return json(200, {
        authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      });
    }

    if (action === "callback") {
      const code = body?.code || new URL(req.url).searchParams.get("code");
      if (!code) return json(400, { error: "Missing OAuth code" });

      const tokens = await exchangeCodeForTokens(code, redirectUri);
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json();

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

      // Tokens written via service role only — never included in API response.
      const { error } = await admin.from("ask_nac_drive_connections").upsert(
        {
          user_email: userEmail,
          google_account_email: profile.email || null,
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          token_expires_at: expiresAt,
          scopes: DRIVE_SCOPES.split(" "),
          status: "active",
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_email" },
      );

      if (error) return json(500, { error: sanitizeErrorMessage(error.message) });
      return json(200, {
        ok: true,
        googleAccountEmail: profile.email,
        tokenExpiresAt: expiresAt,
        scopesCount: DRIVE_SCOPES.split(" ").length,
      });
    }

    if (action === "status") {
      // Safe columns only — tokens are not readable via authenticated RLS.
      const { data } = await admin
        .from("ask_nac_drive_connections")
        .select("google_account_email,status,connected_at,last_error,token_expires_at,scopes")
        .eq("user_email", userEmail)
        .maybeSingle();

      const { data: folders } = await supabase
        .from("ask_nac_drive_sync_folders")
        .select("id,drive_folder_id,folder_name,label,branch_id,department,report_type,sensitivity,auto_ingest,schedule,last_sync_at,last_ingest_at,last_sync_status,enabled")
        .order("created_at", { ascending: false });

      const safeConnection = data
        ? {
            google_account_email: data.google_account_email,
            status: data.status,
            connected_at: data.connected_at,
            last_error: data.last_error,
            token_expires_at: data.token_expires_at,
            scopes_count: Array.isArray(data.scopes) ? data.scopes.length : 0,
          }
        : null;

      return json(200, { connected: Boolean(data), connection: safeConnection, folders: folders || [] });
    }

    if (action === "register_folder") {
      const { data: connection } = await admin
        .from("ask_nac_drive_connections")
        .select("id")
        .eq("user_email", userEmail)
        .maybeSingle();

      if (!connection?.id) return json(400, { error: "Connect Google Drive first." });

      const folderId = String(body?.folderId || "").trim();
      if (!folderId) return json(400, { error: "folderId required" });

      const { data, error } = await supabase
        .from("ask_nac_drive_sync_folders")
        .upsert(
          {
            connection_id: connection.id,
            drive_folder_id: folderId,
            folder_name: body?.folderName || folderId,
            label: body?.label || body?.folderName || folderId,
            default_branch_id: body?.defaultBranchId || body?.branchId || null,
            default_department: body?.defaultDepartment || body?.department || "operations",
            branch_id: body?.branchId || body?.defaultBranchId || null,
            department: body?.department || body?.defaultDepartment || "operations",
            report_type: body?.reportType || "other",
            sensitivity: body?.sensitivity || "internal",
            auto_ingest: Boolean(body?.autoIngest),
            schedule: body?.schedule === "daily" ? "daily" : "manual",
            enabled: true,
          },
          { onConflict: "connection_id,drive_folder_id" },
        )
        .select("id,drive_folder_id,folder_name,label,branch_id,department,report_type,sensitivity,auto_ingest,schedule,last_sync_at,last_ingest_at,last_sync_status,enabled,default_branch_id,default_department")
        .single();

      if (error) return json(500, { error: sanitizeErrorMessage(error.message) });
      return json(200, { folder: data });
    }

    if (action === "run_status") {
      const runId = String(body?.runId || new URL(req.url).searchParams.get("runId") || "").trim();
      if (!runId) return json(400, { error: "runId required" });
      const status = await fetchDriveRunStatus(admin, runId, userEmail);
      if (!status) return json(404, { error: "Drive ingestion run not found." });
      return json(200, { ok: true, ...status });
    }

    if (action === "sync_ingest" || action === "retry_file") {
      const folderRowId = body?.folderId || null;
      const triggerType = body?.triggerType === "scheduled" ? "scheduled" : "manual";
      const retryDriveFileId = action === "retry_file" ? String(body?.driveFileId || "").trim() : null;

      let folderQuery = supabase
        .from("ask_nac_drive_sync_folders")
        .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,enabled")
        .eq("enabled", true);
      if (folderRowId) folderQuery = folderQuery.eq("id", folderRowId);
      if (action === "sync_ingest" && body?.onlyAutoIngest !== false) folderQuery = folderQuery.eq("auto_ingest", true);

      const { data: folders, error: folderError } = await folderQuery;
      if (folderError) return json(500, { error: sanitizeErrorMessage(folderError.message) });
      if (!folders?.length) {
        return json(400, {
          error: folderRowId
            ? "Sync folder not found or not enabled."
            : "No Drive folders are enabled for auto-ingest.",
        });
      }
      if (action === "retry_file" && (!folderRowId || !retryDriveFileId)) {
        return json(400, { error: "folderId and driveFileId are required for retry." });
      }

      const connectionIds = [...new Set(folders.map((folder) => folder.connection_id))];
      const { data: connections } = await admin
        .from("ask_nac_drive_connections")
        .select("id,refresh_token,token_expires_at")
        .in("id", connectionIds)
        .eq("user_email", userEmail);

      const connectionById = new Map((connections || []).map((connection) => [connection.id, connection]));
      const runnableFolders = folders.filter((folder) => connectionById.get(folder.connection_id)?.refresh_token);
      if (!runnableFolders.length) {
        return json(400, { error: "Drive connection not found or revoked." });
      }

      const tokensByConnectionId = new Map<string, string>();
      for (const connection of connections || []) {
        if (!connection.refresh_token) continue;
        const tokens = await refreshAccessToken(connection.refresh_token);
        tokensByConnectionId.set(connection.id, tokens.access_token);
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
      }

      const runs = [];
      const selectedFolderDebug = runnableFolders.map((folder) => ({
        folderRowId: folder.id,
        driveFolderId: folder.drive_folder_id,
        label: folder.label || folder.folder_name || folder.drive_folder_id,
        autoIngest: Boolean(folder.auto_ingest),
        branchId: folder.branch_id || folder.default_branch_id || null,
      }));
      console.info("[vault-drive-sync] queueing Drive ingestion", {
        action,
        selectedFolderCount: selectedFolderDebug.length,
        selectedFolders: selectedFolderDebug,
      });
      for (const folder of runnableFolders) {
        const runId = await createDriveIngestionRun(admin, {
          folder,
          triggerType,
          initialStats: {
            runtimeStage: "queued",
            action,
            sourceTable: "ask_nac_drive_sync_folders",
            selectedFolderCount: selectedFolderDebug.length,
            selectedFolders: selectedFolderDebug,
          },
        });
        runs.push({ runId, folder });
      }

      const edgeRuntime = globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } };
      const waitUntil = edgeRuntime.EdgeRuntime?.waitUntil;
      if (!waitUntil) {
        const message = "Drive ingestion worker was not scheduled because EdgeRuntime.waitUntil is unavailable.";
        await Promise.all(runs.map(({ runId }) =>
          admin
            .from("ask_nac_drive_sync_runs")
            .update({
              status: "failed",
              error: message,
              finished_at: new Date().toISOString(),
              stats: {
                runtimeStage: "schedule_failed",
                action,
                sourceTable: "ask_nac_drive_sync_folders",
                selectedFolderCount: selectedFolderDebug.length,
                selectedFolders: selectedFolderDebug,
              },
            })
            .eq("id", runId)
        ));
        return json(500, { ok: false, error: message, runIds: runs.map((run) => run.runId) });
      }

      const work = Promise.all(
        runs.map(({ runId, folder }) =>
          processDriveIngestionRun(admin, {
            accessToken: tokensByConnectionId.get(folder.connection_id)!,
            folder,
            runId,
            email: userEmail,
            onlyDriveFileId: retryDriveFileId,
            force: action === "retry_file",
          }),
        ),
      );

      waitUntil(work.catch(async (err) => {
        const message = sanitizeErrorMessage(err);
        console.error("[vault-drive-sync] Drive ingestion worker failed", { message });
        await Promise.all(runs.map(({ runId }) =>
          admin
            .from("ask_nac_drive_sync_runs")
            .update({
              status: "failed",
              error: message,
              finished_at: new Date().toISOString(),
              stats: {
                runtimeStage: "worker_failed",
                action,
                sourceTable: "ask_nac_drive_sync_folders",
                selectedFolderCount: selectedFolderDebug.length,
                selectedFolders: selectedFolderDebug,
              },
            })
            .eq("id", runId)
        ));
      }));

      return json(202, {
        ok: true,
        runId: runs[0]?.runId,
        runIds: runs.map((run) => run.runId),
        queued: runs.length,
        status: "queued",
      });
    }

    if (action === "sync") {
      const folderRowId = body?.folderId;
      if (!folderRowId) return json(400, { error: "folderId (sync folder row id) required" });

      const { data: folder } = await supabase
        .from("ask_nac_drive_sync_folders")
        .select("id,connection_id,drive_folder_id,folder_name,default_branch_id,default_department")
        .eq("id", folderRowId)
        .maybeSingle();

      if (!folder?.connection_id) {
        return json(400, { error: "Sync folder not found." });
      }

      // Fetch OAuth credentials via service role — never join tokens into user-scoped queries.
      const { data: connection } = await admin
        .from("ask_nac_drive_connections")
        .select("id,refresh_token,token_expires_at")
        .eq("id", folder.connection_id)
        .eq("user_email", userEmail)
        .maybeSingle();

      if (!connection?.refresh_token) {
        return json(400, { error: "Drive connection not found or revoked." });
      }

      const tokens = await refreshAccessToken(connection.refresh_token);
      const accessToken = tokens.access_token;

      await admin
        .from("ask_nac_drive_connections")
        .update({
          access_token: accessToken,
          token_expires_at: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : connection.token_expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);

      const { data: runRow } = await admin
        .from("ask_nac_drive_sync_runs")
        .insert({
          folder_id: folder.id,
          trigger_type: body?.triggerType === "scheduled" ? "scheduled" : "manual",
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      let pageToken: string | undefined;
      let discovered = 0;
      let skipped = 0;
      let changed = 0;
      const fileManifest: Array<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime: string;
        size?: string;
        md5Checksum?: string;
      }> = [];

      // Metadata-only listing — no downloads, no storage uploads, no vault ingestion.
      do {
        const listing = await listDriveFiles(accessToken, folder.drive_folder_id, pageToken);
        for (const file of listing.files || []) {
          if (file.mimeType === "application/vnd.google-apps.folder") continue;
          discovered += 1;
          fileManifest.push(file);
        }
        pageToken = listing.nextPageToken;
      } while (pageToken);

      for (const driveFile of fileManifest) {
        const { data: existing } = await admin
          .from("ask_nac_files")
          .select("id,content_hash,external_source_modified_at")
          .eq("external_source_id", driveFile.id)
          .eq("uploader_email", userEmail)
          .eq("status", "active")
          .maybeSingle();

        const modifiedAt = driveFile.modifiedTime;
        if (
          existing &&
          existing.external_source_modified_at &&
          new Date(modifiedAt).getTime() <= new Date(existing.external_source_modified_at).getTime()
        ) {
          skipped += 1;
          continue;
        }

        changed += 1;
      }

      await admin
        .from("ask_nac_drive_sync_runs")
        .update({
          status: "completed",
          files_discovered: discovered,
          files_new: changed,
          files_changed: changed,
          files_skipped: skipped,
          finished_at: new Date().toISOString(),
          stats: {
            manifestCount: fileManifest.length,
            metadataOnly: true,
            note: METADATA_ONLY_NOTE,
          },
        })
        .eq("id", runRow?.id);

      await supabase
        .from("ask_nac_drive_sync_folders")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "completed",
        })
        .eq("id", folder.id);

      return json(200, {
        ok: true,
        runId: runRow?.id,
        discovered,
        changed,
        skipped,
        metadataOnly: true,
        manifest: fileManifest.slice(0, 200),
        note: METADATA_ONLY_NOTE,
      });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    return json(500, { error: sanitizeErrorMessage(err) });
  }
});
