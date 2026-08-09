/**
 * Google Drive sync Edge Function for Data Vault bulk ingestion.
 * Deploy: supabase functions deploy vault-drive-sync
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY,
 *           DRIVE_SCHEDULED_INGEST_SECRET (scheduled_ingest action only)
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
  verifyDriveFolderAccess,
  walkDriveFolderTree,
} from "../_shared/vaultDriveIngestion.ts";
import {
  buildDiscoverySummary,
  classifyDrivePath,
  fetchActiveDiscoveryRules,
  groupFilesByOperationalFolder,
} from "../_shared/driveDiscoveryClassifier.ts";
import {
  isScheduledIngestSecretConfigured,
  runScheduledDriveIngestion,
  validateScheduledIngestSecret,
} from "../_shared/vaultDriveScheduledIngest.ts";

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

const OPERATIONAL_FOLDER_REPORT_TYPES: Array<[RegExp, string]> = [
  [/\bcash[\s-]?up|cashup|daily cash report\b/i, "cash_up"],
  [/\bweekly dashboards?\b|\bexecutive reports?\b.*\bweekly\b/i, "weekly_dashboard"],
  [/\blog ?book\b/i, "daily_logbook"],
  [/\bdaily reception\b/i, "daily_reception"],
  [/\bdaily briefing\b|\bbriefing\b/i, "daily_briefing"],
  [/\bguest feedback\b/i, "guest_feedback"],
  [/\bccm|foodics|reconciliation\b/i, "ccm_reconciliation"],
  [/\bdiscount|comp|voids?\b/i, "discount_void_comp"],
  [/\bbreakage\b/i, "breakage_report"],
  [/\bdaily napkins count\b|\bnapkins count\b/i, "ignore"],
  [/\bmonthly cash safe\b/i, "ignore"],
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function inferOperationalReportType(name = "", fallback = "other") {
  const text = String(name || "");
  const hit = OPERATIONAL_FOLDER_REPORT_TYPES.find(([pattern]) => pattern.test(text));
  return hit?.[1] || fallback || "other";
}

function resolveRegisteredReportType(folderName = "", requestedReportType = "other") {
  const inferred = inferOperationalReportType(folderName, "other");
  if (inferred === "cash_up") return "cash_up";
  if (inferred === "weekly_dashboard") return "weekly_dashboard";
  if (inferred === "ignore") return "discovery_root";
  if (/^(daily|weekly)$/i.test(String(folderName || "").trim())) return "discovery_root";
  return requestedReportType || inferred || "other";
}

function summarizeDriveItem(file: any) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime || null,
    size: file.size || null,
    isFolder: file.mimeType === "application/vnd.google-apps.folder",
    likelyReportType: inferOperationalReportType(file.name, "other"),
  };
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return json(500, { error: "Supabase env not configured" });

    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = String(body?.action || new URL(req.url).searchParams.get("action") || "status");

    if (action === "scheduled_ingest") {
      if (req.method !== "POST") return json(405, { error: "Method not allowed" });
      if (!serviceRoleKey) return json(500, { error: "Service role not configured" });
      if (!isScheduledIngestSecretConfigured()) {
        return json(503, { error: "Scheduled ingest not configured (DRIVE_SCHEDULED_INGEST_SECRET)." });
      }
      if (!validateScheduledIngestSecret(req)) {
        return json(401, { error: "Invalid scheduled ingest secret" });
      }

      const admin = createClient(supabaseUrl, serviceRoleKey);
      const summary = await runScheduledDriveIngestion(admin, {
        reportType: body?.reportType,
        reportTypes: Array.isArray(body?.reportTypes) ? body.reportTypes : undefined,
        maxFolders: body?.maxFolders,
        maxFilesPerRun: body?.maxFilesPerRun,
        maxFilesToProcess: body?.maxFilesToProcess,
        budgetMs: body?.budgetMs,
      });
      console.info("[vault-drive-sync] scheduled_ingest complete", summary);
      return json(200, { ok: true, ...summary });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

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

      // Google often omits refresh_token on re-consent — never wipe a durable token with null.
      const { data: existingConn } = await admin
        .from("ask_nac_drive_connections")
        .select("refresh_token")
        .eq("user_email", userEmail)
        .maybeSingle();
      const refreshToken = tokens.refresh_token || existingConn?.refresh_token || null;
      if (!refreshToken) {
        return json(400, {
          error:
            "Google did not return a refresh token. Reconnect and approve offline access (consent screen).",
        });
      }

      // Tokens written via service role only — never included in API response.
      const { error } = await admin.from("ask_nac_drive_connections").upsert(
        {
          user_email: userEmail,
          google_account_email: profile.email || null,
          refresh_token: refreshToken,
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
        reconnectRequired: false,
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

      const reconnectRequired =
        data?.status === "reconnect_required" ||
        /reconnect|token|refresh|revoked|invalid_grant|Bad Request/i.test(
          String(data?.last_error || ""),
        );

      const safeConnection = data
        ? {
            google_account_email: data.google_account_email,
            status: data.status,
            connected_at: data.connected_at,
            last_error: data.last_error,
            token_expires_at: data.token_expires_at,
            scopes_count: Array.isArray(data.scopes) ? data.scopes.length : 0,
            reconnect_required: reconnectRequired,
            health: reconnectRequired
              ? "CONNECTION_REQUIRED"
              : data.status === "active"
                ? "HEALTHY"
                : "DEGRADED",
          }
        : null;

      // Next automatic sync: 03:00 Asia/Riyadh daily (= 00:00 UTC).
      const now = new Date();
      const nextUtc = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0),
      );
      if (nextUtc.getTime() <= now.getTime()) {
        nextUtc.setUTCDate(nextUtc.getUTCDate() + 1);
      }

      const priorityFolders = (folders || []).filter((folder) =>
        ["cash_up", "daily_logbook"].includes(String(folder.report_type || "")),
      );

      return json(200, {
        connected: Boolean(data),
        connection: safeConnection,
        folders: folders || [],
        schedule: {
          cronUtc: "0 0 * * *",
          timezone: "Asia/Riyadh",
          localTime: "03:00",
          nextRunAt: nextUtc.toISOString(),
          priorityReportTypes: ["cash_up", "daily_logbook"],
          priorityFolderCount: priorityFolders.length,
        },
      });
    }

    if (action === "browse") {
      const { data: connection } = await admin
        .from("ask_nac_drive_connections")
        .select("id,refresh_token,token_expires_at")
        .eq("user_email", userEmail)
        .maybeSingle();

      if (!connection?.refresh_token) {
        return json(400, { error: "Drive connection not found or revoked." });
      }

      const folderId = String(body?.folderId || "root").trim();
      const recursive = Boolean(body?.recursive);
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

      const folderInfo = folderId === "root"
        ? { id: "root", name: "My Drive", mimeType: "application/vnd.google-apps.folder" }
        : await verifyDriveFolderAccess(accessToken, folderId);

      if (recursive) {
        const traversal = await walkDriveFolderTree(accessToken, {
          rootFolderId: folderId,
          rootLabel: folderInfo.name || folderId,
          maxDepth: 6,
          maxItems: 500,
        });
        return json(200, {
          ok: true,
          folder: summarizeDriveItem(folderInfo),
          recursive: true,
          foldersScanned: traversal.foldersScanned,
          maxDepth: traversal.maxDepth,
          truncated: traversal.truncated,
          files: traversal.files.map(summarizeDriveItem),
        });
      }

      let pageToken: string | undefined;
      const items = [];
      do {
        const listing = await listDriveFiles(accessToken, folderId, pageToken);
        items.push(...(listing.files || []).map(summarizeDriveItem));
        pageToken = listing.nextPageToken;
      } while (pageToken);

      return json(200, {
        ok: true,
        folder: summarizeDriveItem(folderInfo),
        recursive: false,
        folders: items.filter((item) => item.isFolder),
        files: items.filter((item) => !item.isFolder),
      });
    }

    if (action === "register_folder") {
      const { data: connection } = await admin
        .from("ask_nac_drive_connections")
        .select("id,refresh_token,token_expires_at")
        .eq("user_email", userEmail)
        .maybeSingle();

      if (!connection?.id || !connection.refresh_token) return json(400, { error: "Connect Google Drive first." });

      const folderId = String(body?.folderId || "").trim();
      if (!folderId) return json(400, { error: "folderId required" });
      if (Boolean(body?.autoIngest) && !(body?.branchId || body?.defaultBranchId)) {
        return json(400, { error: "Select a branch before enabling Drive auto-ingest." });
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

      const verifiedFolder = await verifyDriveFolderAccess(accessToken, folderId);
      const folderName = body?.folderName || verifiedFolder.name || folderId;
      const requestedReportType = body?.reportType || "other";
      const isDiscoveryRoot = Boolean(body?.isDiscoveryRoot) || /^(daily|weekly)$/i.test(String(folderName || "").trim());
      const reportType = isDiscoveryRoot ? "discovery_root" : resolveRegisteredReportType(folderName, requestedReportType);

      const { data, error } = await supabase
        .from("ask_nac_drive_sync_folders")
        .upsert(
          {
            connection_id: connection.id,
            drive_folder_id: folderId,
            folder_name: folderName,
            label: body?.label || folderName,
            default_branch_id: body?.defaultBranchId || body?.branchId || null,
            default_department: body?.defaultDepartment || body?.department || "operations",
            branch_id: body?.branchId || body?.defaultBranchId || null,
            department: body?.department || body?.defaultDepartment || "operations",
            report_type: reportType,
            sensitivity: body?.sensitivity || "internal",
            auto_ingest: Boolean(body?.autoIngest),
            is_discovery_root: isDiscoveryRoot,
            schedule: body?.schedule === "daily" ? "daily" : "manual",
            enabled: true,
          },
          { onConflict: "connection_id,drive_folder_id" },
        )
        .select("id,drive_folder_id,folder_name,label,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,schedule,last_sync_at,last_ingest_at,last_sync_status,enabled,default_branch_id,default_department")
        .single();

      if (error) return json(500, { error: sanitizeErrorMessage(error.message) });
      return json(200, { folder: data });
    }

    if (action === "discover_folders") {
      const { data: connection } = await admin
        .from("ask_nac_drive_connections")
        .select("id,refresh_token,token_expires_at")
        .eq("user_email", userEmail)
        .maybeSingle();
      if (!connection?.id || !connection.refresh_token) return json(400, { error: "Connect Google Drive first." });

      const tokens = await refreshAccessToken(connection.refresh_token);
      const accessToken = tokens.access_token;
      let folderQuery = admin
        .from("ask_nac_drive_sync_folders")
        .select("*")
        .eq("connection_id", connection.id)
        .eq("enabled", true)
        .eq("is_discovery_root", true);
      const folderRowId = String(body?.folderRowId || "").trim();
      if (folderRowId) folderQuery = folderQuery.eq("id", folderRowId);
      const { data: roots, error: rootsError } = await folderQuery;
      if (rootsError) return json(500, { error: sanitizeErrorMessage(rootsError.message) });
      if (!roots?.length) return json(400, { error: "Register a Daily or Weekly discovery root first." });

      const allClassifications: Record<string, unknown>[] = [];
      for (const root of roots) {
        const branchId = root.branch_id || root.default_branch_id || null;
        const rules = await fetchActiveDiscoveryRules(admin, branchId);
        const rootFolder = await verifyDriveFolderAccess(accessToken, root.drive_folder_id);
        const traversal = await walkDriveFolderTree(accessToken, {
          rootFolderId: root.drive_folder_id,
          rootLabel: rootFolder.name || root.folder_name || "Drive",
        });
        const groups = groupFilesByOperationalFolder(traversal.files);
        for (const group of groups) {
          const sampleFilenames = group.files.slice(0, 5).map((file) => file.name).filter(Boolean);
          const decision = classifyDrivePath(group.folderPath, sampleFilenames[0] || "", rules, branchId);
          allClassifications.push({
            ...decision,
            discoveryRoot: root.folder_name || root.label,
            sampleFilenames,
            fileCount: group.files.length,
          });
          await admin.from("ask_nac_drive_discovery_candidates").upsert(
            {
              connection_id: connection.id,
              discovery_root_folder_id: root.id,
              folder_path: group.folderPath,
              detected_report_type: decision.detectedReportType,
              recommended_action: decision.recommendedAction,
              confidence: decision.confidence,
              reason: decision.reason,
              sample_filenames: sampleFilenames,
              file_count: group.files.length,
              branch_id: branchId,
              status: decision.needsApproval ? "pending" : decision.recommendedAction === "ignore" ? "ignored" : "approved",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "discovery_root_folder_id,folder_path" },
          );
        }
      }

      const summary = buildDiscoverySummary(allClassifications);
      return json(200, { ok: true, summary, items: allClassifications });
    }

    if (action === "run_status") {
      const runId = String(body?.runId || new URL(req.url).searchParams.get("runId") || "").trim();
      if (!runId) return json(400, { error: "runId required" });
      const status = await fetchDriveRunStatus(admin, runId, userEmail);
      if (!status) return json(404, { error: "Drive ingestion run not found." });
      return json(200, { ok: true, ...status });
    }

    if (action === "process_run") {
      const requestedRunIds = Array.isArray(body?.runIds)
        ? body.runIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
        : [String(body?.runId || "").trim()].filter(Boolean);
      if (!requestedRunIds.length) return json(400, { error: "runId or runIds required" });

      const processedRuns = [];
      const processStartedAt = Date.now();
      const PROCESS_RUN_BUDGET_MS = Number(body?.budgetMs) || 50_000;
      for (const runId of requestedRunIds) {
        if (Date.now() - processStartedAt > PROCESS_RUN_BUDGET_MS - 3_000) {
          processedRuns.push({
            runId,
            ok: false,
            skipped: true,
            reason: "time_budget_exhausted",
            error: "Process-run time budget exhausted; remaining runs stay queued for the next worker call.",
          });
          continue;
        }
        const status = await fetchDriveRunStatus(admin, runId, userEmail);
        if (!status?.run?.folder_id && !status?.run?.folder?.id) {
          return json(404, { error: "Drive ingestion run not found.", runId });
        }

        const folderId = status.run.folder_id || status.run.folder.id;
        const { data: folder } = await admin
          .from("ask_nac_drive_sync_folders")
          .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,enabled")
          .eq("id", folderId)
          .maybeSingle();
        if (!folder?.connection_id || !folder.drive_folder_id) {
          await admin.from("ask_nac_drive_sync_runs").update({
            status: "failed",
            runtime_stage: "loading_registered_folders",
            error_code: "drive_folder_missing",
            error: "Registered Drive folder row is missing.",
            error_message: "Registered Drive folder row is missing.",
            finished_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", runId);
          processedRuns.push({ runId, ok: false });
          continue;
        }

        await admin.from("ask_nac_drive_sync_runs").update({
          status: "running",
          runtime_stage: "loading_connection",
          updated_at: new Date().toISOString(),
        }).eq("id", runId);

        const { data: connection } = await admin
          .from("ask_nac_drive_connections")
          .select("id,refresh_token,token_expires_at")
          .eq("id", folder.connection_id)
          .eq("user_email", userEmail)
          .maybeSingle();

        if (!connection?.refresh_token) {
          const message = "Google Drive token expired or revoked. Reconnect required.";
          await admin.from("ask_nac_drive_sync_runs").update({
            status: "failed",
            runtime_stage: "loading_access_token",
            error_code: "drive_reconnect_required",
            error: message,
            error_message: message,
            finished_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", runId);
          processedRuns.push({ runId, ok: false });
          continue;
        }

        let accessToken = "";
        try {
          await admin.from("ask_nac_drive_sync_runs").update({
            runtime_stage: "loading_access_token",
            updated_at: new Date().toISOString(),
          }).eq("id", runId);
          const tokens = await refreshAccessToken(connection.refresh_token);
          accessToken = tokens.access_token;
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
          await admin.from("ask_nac_drive_sync_runs").update({
            runtime_stage: "token_refreshed",
            stats: {
              ...(status.run.stats || {}),
              tokenRefreshed: true,
            },
            updated_at: new Date().toISOString(),
          }).eq("id", runId);
        } catch (err) {
          const detail = sanitizeErrorMessage(err) || "Refresh failed";
          const message =
            "Google Drive authorization expired. Reconnect Google Drive to resume automatic Cashup/Logbook ingestion.";
          await admin.from("ask_nac_drive_connections").update({
            status: "reconnect_required",
            last_error: detail,
            updated_at: new Date().toISOString(),
          }).eq("id", connection.id);
          await admin.from("ask_nac_drive_sync_runs").update({
            status: "failed",
            runtime_stage: "token_refresh_failed",
            error_code: "drive_reconnect_required",
            error: message,
            error_message: `${message} (${detail})`,
            finished_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", runId);
          processedRuns.push({ runId, ok: false });
          continue;
        }

        await processDriveIngestionRun(admin, {
          accessToken,
          folder,
          runId,
          email: userEmail,
          onlyDriveFileId: body?.driveFileId || null,
          force: Boolean(body?.force),
          maxFilesToProcess: Number(body?.maxFilesToProcess || 50),
        });
        processedRuns.push({ runId, ok: true });
      }

      return json(200, { ok: true, processedRuns });
    }

    if (action === "sync_ingest" || action === "retry_file") {
      const folderRowId = body?.folderId || null;
      const triggerType = body?.triggerType === "scheduled" ? "scheduled" : "manual";
      const retryDriveFileId = action === "retry_file" ? String(body?.driveFileId || "").trim() : null;

      let folderQuery = admin
        .from("ask_nac_drive_sync_folders")
        .select("id,connection_id,drive_folder_id,folder_name,label,default_branch_id,default_department,branch_id,department,report_type,sensitivity,auto_ingest,is_discovery_root,enabled")
        .eq("enabled", true)
        .not("drive_folder_id", "is", null);
      if (folderRowId) folderQuery = folderQuery.eq("id", folderRowId);
      if (action === "sync_ingest" && body?.onlyAutoIngest !== false) folderQuery = folderQuery.eq("auto_ingest", true);
      // Manual Sync & Ingest targets operational auto-ingest folders, not discovery roots.
      if (action === "sync_ingest" && body?.includeDiscoveryRoots !== true) {
        folderQuery = folderQuery.or("is_discovery_root.is.null,is_discovery_root.eq.false");
      }

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
        .select("id,user_email,refresh_token,token_expires_at")
        .in("id", connectionIds)
        .eq("user_email", userEmail);

      const connectionById = new Map((connections || []).map((connection) => [connection.id, connection]));
      const runnableFolders = folders.filter((folder) => connectionById.get(folder.connection_id)?.refresh_token);
      if (!runnableFolders.length) {
        return json(400, { error: "Drive connection not found or revoked." });
      }

      const runs = [];
      const selectedFolderDebug = runnableFolders.map((folder) => ({
        folderRowId: folder.id,
        driveFolderId: folder.drive_folder_id,
        label: folder.label || folder.folder_name || folder.drive_folder_id,
        autoIngest: Boolean(folder.auto_ingest),
        branchId: folder.branch_id || folder.default_branch_id || null,
        department: folder.department || folder.default_department || null,
        reportType: folder.report_type || null,
      }));
      console.info("[vault-drive-sync] queueing Drive ingestion", {
        action,
        selectedFolderCount: selectedFolderDebug.length,
        selectedFolders: selectedFolderDebug,
      });
      const skippedActive = [];
      for (const folder of runnableFolders) {
        try {
          const runId = await createDriveIngestionRun(admin, {
            folder,
            triggerType,
            initialStats: {
              runtimeStage: "queued",
              action,
              sourceTable: "ask_nac_drive_sync_folders",
              selectedFolderCount: selectedFolderDebug.length,
              selectedFoldersCount: selectedFolderDebug.length,
              selectedFolders: selectedFolderDebug,
              selectedDriveFolderIds: selectedFolderDebug.map((item) => item.driveFolderId),
              selectedFolderLabels: selectedFolderDebug.map((item) => item.label),
              selectedAutoIngestFlags: selectedFolderDebug.map((item) => item.autoIngest),
              selectedBranchIds: selectedFolderDebug.map((item) => item.branchId),
              selectedReportTypes: selectedFolderDebug.map((item) => item.reportType),
            },
          });
          runs.push({ runId, folder });
        } catch (err) {
          const message = sanitizeErrorMessage(err) || String((err as Error)?.message || err);
          if (/already (running|queued)/i.test(message) || /double-ingest/i.test(message)) {
            skippedActive.push({
              folderId: folder.id,
              driveFolderId: folder.drive_folder_id,
              reason: "concurrency_lock",
              error: message,
            });
            continue;
          }
          throw err;
        }
      }

      if (!runs.length) {
        return json(409, {
          error: "Drive ingestion already active for the selected folders.",
          skippedActive,
        });
      }

      return json(202, {
        ok: true,
        runId: runs[0]?.runId,
        runIds: runs.map((run) => run.runId),
        queued: runs.length,
        skippedActive,
        status: "queued",
        requiresClientProcessing: true,
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

      let discovered = 0;
      let skipped = 0;
      let changed = 0;
      const fileManifest: Array<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime?: string;
        size?: string;
        md5Checksum?: string;
        version?: string;
        relativePath?: string;
        folderPath?: string;
      }> = [];

      // Metadata-only recursive discovery — no downloads, no storage uploads, no vault ingestion.
      const rootFolder = await verifyDriveFolderAccess(accessToken, folder.drive_folder_id);
      const traversal = await walkDriveFolderTree(accessToken, {
        rootFolderId: folder.drive_folder_id,
        rootLabel: rootFolder.name || folder.folder_name || folder.drive_folder_id,
      });
      for (const file of traversal.files || []) {
        discovered += 1;
        fileManifest.push(file);
      }

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
          runtime_stage: "metadata_completed",
          files_discovered: discovered,
          files_new: changed,
          files_changed: changed,
          files_skipped: skipped,
          finished_at: new Date().toISOString(),
          stats: {
            manifestCount: fileManifest.length,
            metadataOnly: true,
            recursive: true,
            foldersScanned: traversal.foldersScanned,
            maxDepth: traversal.maxDepth,
            duplicateFileIdsSkipped: traversal.duplicateCount,
            truncated: traversal.truncated,
            rootFolderName: rootFolder.name || null,
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
        recursive: true,
        foldersScanned: traversal.foldersScanned,
        maxDepth: traversal.maxDepth,
        truncated: traversal.truncated,
        manifest: fileManifest.slice(0, 200),
        note: METADATA_ONLY_NOTE,
      });
    }

    return json(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    return json(500, { error: sanitizeErrorMessage(err) });
  }
});
