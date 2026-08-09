const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260617193000_ask_nac_drive_ingestion.sql"),
  "utf8",
);
const discoveryMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260623210000_ask_nac_drive_discovery_rules.sql"),
  "utf8",
);
const driveFunction = fs.readFileSync(
  path.join(root, "supabase/functions/vault-drive-sync/index.ts"),
  "utf8",
);
const driveHelper = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/vaultDriveIngestion.ts"),
  "utf8",
);
const scheduledIngest = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/vaultDriveScheduledIngest.ts"),
  "utf8",
);
const vaultApi = fs.readFileSync(path.join(root, "src/lib/askNacVaultApi.js"), "utf8");
const panel = fs.readFileSync(
  path.join(root, "src/dashboard/intelligence/AskNacDataVaultPanel.jsx"),
  "utf8",
);

describe("Google Drive Company Knowledge ingestion", () => {
  test("stores folder ingestion defaults and progress counters", () => {
    expect(migration).toMatch(/add column if not exists label text/);
    expect(migration).toMatch(/add column if not exists branch_id text/);
    expect(migration).toMatch(/add column if not exists department text/);
    expect(migration).toMatch(/add column if not exists report_type text/);
    expect(migration).toMatch(/add column if not exists sensitivity text/);
    expect(migration).toMatch(/add column if not exists auto_ingest boolean/);
    expect(migration).toMatch(/add column if not exists last_ingest_at timestamptz/);
    expect(migration).toMatch(/discovered_count/);
    expect(migration).not.toMatch(/add column if not exists folders_scanned/);
    expect(migration).not.toMatch(/add column if not exists max_depth/);
    expect(migration).toMatch(/downloaded_count/);
    expect(migration).toMatch(/indexed_count/);
    expect(migration).toMatch(/current_file text/);
  });

  test("records per-file Drive failures for System Details and retry", () => {
    expect(migration).toMatch(/create table if not exists public\.ask_nac_drive_sync_run_files/);
    expect(migration).toMatch(/drive_file_id text not null/);
    expect(migration).not.toMatch(/^  folder_path text/m);
    expect(migration).not.toMatch(/^  relative_path text/m);
    expect(migration).not.toMatch(/^  depth int not null default 0/m);
    expect(migration).toMatch(/error text/);
    expect(driveFunction).toMatch(/action === "retry_file"/);
    expect(panel).toMatch(/retryDriveIngestionFile/);
    expect(panel).toMatch(/onRetryDriveFile/);
  });

  test("metadata sync still exists separately from ingestion", () => {
    expect(driveFunction).toMatch(/action === "sync"/);
    expect(driveFunction).toMatch(/metadataOnly: true/);
    expect(vaultApi).toMatch(/export async function triggerDriveSync/);
    expect(panel).toMatch(/Sync Metadata/);
  });

  test("auto_ingest false lists files without download", () => {
    expect(driveHelper).toMatch(/if \(!folder\.auto_ingest\)/);
    expect(driveHelper).toMatch(/Folder auto_ingest=false; metadata listed only/);
    expect(driveHelper).not.toMatch(/tokens.*response/i);
  });

  test("auto_ingest true downloads supported files and indexes chunks", () => {
    expect(driveFunction).toMatch(/action === "sync_ingest"/);
    expect(driveFunction).toMatch(/processDriveIngestionRun/);
    expect(driveHelper).toMatch(/downloadDriveFile/);
    expect(driveHelper).toMatch(/persistChunks/);
    expect(driveHelper).toMatch(/searchable: true/);
  });

  test("Drive listing supports Shared Drives and logs first response", () => {
    expect(driveHelper).toMatch(/supportsAllDrives: "true"/);
    expect(driveHelper).toMatch(/includeItemsFromAllDrives: "true"/);
    expect(driveFunction).toMatch(/supportsAllDrives: "true"/);
    expect(driveFunction).toMatch(/includeItemsFromAllDrives: "true"/);
    expect(driveHelper).toMatch(/firstDriveListResponse/);
    expect(driveHelper).toMatch(/console\.info\("\[vault-drive-ingest\] first Drive list response"/);
  });

  test("Drive and run-status operations have hard timeouts", () => {
    expect(driveHelper).toMatch(/DRIVE_FETCH_TIMEOUT_MS/);
    expect(driveHelper).toMatch(/DB_OPERATION_TIMEOUT_MS/);
    expect(driveHelper).toMatch(/function timeoutSignal/);
    expect(driveHelper).toMatch(/async function withTimeout/);
    expect(driveHelper).toMatch(/async function driveFetch/);
    expect(driveHelper).toMatch(/Drive run update \$\{runId\}/);
    expect(driveHelper).toMatch(/drive_request_timeout/);
    expect(driveHelper).toMatch(/operation_timeout/);
  });

  test("ingestion run records selected folder IDs and scheduling failures", () => {
    expect(driveFunction).toMatch(/selectedFolderDebug/);
    expect(driveFunction).toMatch(/sourceTable: "ask_nac_drive_sync_folders"/);
    expect(driveFunction).toMatch(/driveFolderId: folder\.drive_folder_id/);
    expect(driveFunction).toMatch(/action === "process_run"/);
    expect(driveFunction).toMatch(/requiresClientProcessing: true/);
    expect(vaultApi).toMatch(/processDriveIngestionRuns/);
  });

  test("recursively discovers nested Drive folders before indexing files", () => {
    expect(driveHelper).toMatch(/export async function walkDriveFolderTree/);
    expect(driveHelper).toMatch(/item\.mimeType === GOOGLE_FOLDER_MIME/);
    expect(driveHelper).toMatch(/queue\.push\(\{/);
    expect(driveHelper).toMatch(/folderPath: joinDrivePath\(\[current\.folderPath, item\.name\]\)/);
    expect(driveHelper).toMatch(/files = traversal\.files/);
    expect(driveHelper).toMatch(/await processOneDriveFile/);
  });

  test("folder scans are persisted before Drive list completes", () => {
    expect(driveHelper).toMatch(/onFolderScanned/);
    expect(driveHelper).toMatch(/first_drive_list_call/);
    expect(driveHelper).toMatch(/runStats\.folders_scanned = info\.foldersScanned/);
    expect(driveHelper).toMatch(/runStats\.max_depth = info\.maxDepth/);
    expect(driveHelper).toMatch(/currentDriveFolderId = info\.folderId/);
    expect(driveHelper).toMatch(/current_file: `Scanning \$\{info\.folderPath\}`/);
  });

  test("run status normalizes folder counters from stats JSON", () => {
    expect(driveHelper).toMatch(/folders_scanned: Number\(run\.stats\?\.folders_scanned/);
    expect(driveHelper).toMatch(/max_depth: Number\(run\.stats\?\.max_depth/);
    expect(driveHelper).toMatch(/delete next\.folders_scanned/);
    expect(driveHelper).toMatch(/delete next\.max_depth/);
    expect(panel).toMatch(/run\.stats\?\.folders_scanned/);
    expect(panel).toMatch(/run\.stats\?\.max_depth/);
  });

  test("root folder access is verified and empty folders complete explicitly", () => {
    expect(driveHelper).toMatch(/export async function verifyDriveFolderAccess/);
    expect(driveHelper).toMatch(/fields: "id,name,mimeType,trashed,driveId,parents,capabilities"/);
    expect(driveHelper).toMatch(/drive_folder_id_invalid/);
    expect(driveHelper).toMatch(/status: "completed_empty"/);
    expect(driveHelper).toMatch(/Drive folder scanned successfully but no child files\/folders were returned/);
  });

  test("nested folder traversal preserves path metadata and indexes nested files", () => {
    expect(driveHelper).toMatch(/relativePath: joinDrivePath\(\[current\.folderPath, item\.name\]\)/);
    expect(driveHelper).toMatch(/folderPath: driveFile\.folderPath/);
    expect(driveHelper).toMatch(/relativePath: driveFile\.relativePath/);
    expect(driveHelper).toMatch(/current_file: driveFile\.relativePath/);
    expect(driveHelper).toMatch(/notes: `Imported from Google Drive path/);
    expect(panel).toMatch(/file\.stats\?\.relativePath \|\| file\.file_name/);
  });

  test("recursive traversal prevents loops and duplicate file IDs", () => {
    expect(driveHelper).toMatch(/visitedFolderIds = new Set/);
    expect(driveHelper).toMatch(/seenFileIds = new Set/);
    expect(driveHelper).toMatch(/visitedFolderIds\.has\(current\.folderId\)/);
    expect(driveHelper).toMatch(/seenFileIds\.has\(item\.id\)/);
    expect(driveHelper).toMatch(/MAX_DRIVE_FOLDER_DEPTH/);
    expect(driveHelper).toMatch(/MAX_DRIVE_ITEMS_PER_RUN/);
  });

  test("Google Docs and Sheets are exported into chunkable formats", () => {
    expect(driveHelper).toMatch(/application\/vnd\.google-apps\.document/);
    expect(driveHelper).toMatch(/exportMime: "text\/plain"/);
    expect(driveHelper).toMatch(/application\/vnd\.google-apps\.spreadsheet/);
    expect(driveHelper).toMatch(/exportMime: "text\/csv"/);
    expect(driveHelper).toMatch(/Google Slides ingestion is not supported yet/);
  });

  test("Drive DOCX extraction uses Mammoth arrayBuffer option for Deno Edge", () => {
    expect(driveHelper).toMatch(/extension === "docx"/);
    expect(driveHelper).toMatch(/mammoth\.extractRawText\(\{ arrayBuffer \}\)/);
    expect(driveHelper).not.toMatch(/mammoth\.extractRawText\(\{ buffer: download\.buffer \}\)/);
  });

  test("unchanged Drive files are skipped and changed files version/reindex", () => {
    expect(driveHelper).toMatch(/isUnchanged/);
    expect(driveHelper).toMatch(/source_external_version/);
    expect(driveHelper).toMatch(/source_external_checksum/);
    expect(driveHelper).toMatch(/createFileVersion/);
    expect(driveHelper).toMatch(/ask_nac_document_chunks"\)\.delete\(\)\.eq\("file_id"/);
  });

  test("one failed file does not fail the whole batch", () => {
    expect(driveHelper).toMatch(/catch \(err\)/);
    expect(driveHelper).toMatch(/counters\.failed_count \+= 1/);
    expect(driveHelper).toMatch(/partial/);
  });

  test("Company Knowledge status does not wait on Drive or coverage calls", () => {
    expect(panel).toMatch(/const statusReady = registryAttempted/);
    expect(panel).toMatch(/fetchDriveSyncStatus/);
    expect(panel).toMatch(/Drive status unavailable/);
    expect(panel).toMatch(/Drive ingestion \{driveIngestStats\.status\}/);
  });

  test("Executive Reports / Weekly Dashboards folder maps to weekly_dashboard report type", () => {
    expect(driveHelper).toMatch(/weekly_dashboard/);
    expect(driveHelper).toMatch(/vaultWeeklyDashboardParser/);
    expect(driveFunction).toMatch(/weekly dashboards\?\\b/);
    expect(panel).toMatch(/weekly_dashboard/);
    expect(panel).toMatch(/executive reports\?/);
  });

  test("smart Drive discovery uses approval rules and discovery roots", () => {
    expect(discoveryMigration).toMatch(/ask_nac_drive_discovery_rules/);
    expect(discoveryMigration).toMatch(/ask_nac_drive_discovery_candidates/);
    expect(discoveryMigration).toMatch(/is_discovery_root/);
    expect(driveHelper).toMatch(/driveDiscoveryClassifier/);
    expect(driveHelper).toMatch(/shouldIngestDiscoveryDecision/);
    expect(driveFunction).toMatch(/discover_folders/);
    expect(driveFunction).toMatch(/is_discovery_root/);
  });
});

describe("scheduled Drive ingestion (Phase 1)", () => {
  test("scheduled_ingest action requires DRIVE_SCHEDULED_INGEST_SECRET", () => {
    expect(driveFunction).toMatch(/action === "scheduled_ingest"/);
    expect(driveFunction).toMatch(/DRIVE_SCHEDULED_INGEST_SECRET/);
    expect(driveFunction).toMatch(/validateScheduledIngestSecret/);
    expect(driveFunction).toMatch(/Invalid scheduled ingest secret/);
    expect(driveFunction).toMatch(/Scheduled ingest not configured/);
    expect(scheduledIngest).toMatch(/validateScheduledIngestSecret/);
    expect(scheduledIngest).toMatch(/DRIVE_SCHEDULED_INGEST_SECRET/);
  });

  test("scheduled ingest loads only enabled daily auto-ingest folders", () => {
    expect(scheduledIngest).toMatch(/\.eq\("enabled", true\)/);
    expect(scheduledIngest).toMatch(/\.eq\("auto_ingest", true\)/);
    expect(scheduledIngest).toMatch(/\.eq\("schedule", "daily"\)/);
    expect(scheduledIngest).toMatch(/ask_nac_drive_sync_folders/);
  });

  test("scheduled ingest processes runs inline via processDriveIngestionRun", () => {
    expect(scheduledIngest).toMatch(/createDriveIngestionRun/);
    expect(scheduledIngest).toMatch(/triggerType: "scheduled"/);
    expect(scheduledIngest).toMatch(/await processDriveIngestionRun/);
    expect(scheduledIngest).not.toMatch(/requiresClientProcessing/);
    expect(driveFunction).toMatch(/runScheduledDriveIngestion/);
  });

  test("scheduled ingest returns structured summary counters", () => {
    expect(scheduledIngest).toMatch(/foldersChecked/);
    expect(scheduledIngest).toMatch(/foldersProcessed/);
    expect(scheduledIngest).toMatch(/runsCreated/);
    expect(scheduledIngest).toMatch(/filesDiscovered/);
    expect(scheduledIngest).toMatch(/newFiles/);
    expect(scheduledIngest).toMatch(/changedFiles/);
    expect(scheduledIngest).toMatch(/skippedFiles/);
    expect(scheduledIngest).toMatch(/ingestedFiles/);
    expect(scheduledIngest).toMatch(/failedFiles/);
    expect(scheduledIngest).toMatch(/durationMs/);
    expect(scheduledIngest).toMatch(/reason/);
    expect(driveFunction).toMatch(/ok: true, \.\.\.summary/);
  });

  test("scheduled ingest reuses unchanged-file idempotency in existing pipeline", () => {
    expect(scheduledIngest).toMatch(/processDriveIngestionRun/);
    expect(driveHelper).toMatch(/isUnchanged/);
    expect(driveHelper).toMatch(/Identical content already indexed/);
    expect(driveHelper).toMatch(/Unchanged Drive file/);
  });

  test("cash_up XLSX Drive ingest uses workbook parser and parse-before-delete", () => {
    expect(driveHelper).toMatch(/parseCashUpWorkbookFromXlsxBuffer/);
    expect(driveHelper).toMatch(/if \(!validateCashUpWorkbookParse\(parsed\)\)/);
    expect(driveHelper).toMatch(/cash_up_workbook_parsed/);
    expect(driveHelper).toMatch(/existing facts preserved/);
    expect(driveHelper).toMatch(/replaceStructuredFactsForFile/);
    expect(driveHelper).toMatch(/parsing_started/);
    expect(driveHelper).toMatch(/facts_persisting/);
    expect(driveHelper).toMatch(/CHUNK_INSERT_BATCH_SIZE/);
  });
});

describe("Drive indexing stall recovery", () => {
  const factsReplace = fs.readFileSync(
    path.join(root, "supabase/functions/_shared/vaultStructuredFactsReplace.ts"),
    "utf8",
  );

  test("large structured fact replace batches by file_version_id", () => {
    expect(factsReplace).toMatch(/STRUCTURED_FACTS_INSERT_BATCH_SIZE = 250/);
    expect(factsReplace).toMatch(/replaceViaVersionedBatches/);
    expect(factsReplace).toMatch(/parse-before-delete/);
    expect(factsReplace).toMatch(/neq\("file_version_id", versionId\)/);
  });

  test("completeJob cannot leave runs stuck after facts persist", () => {
    expect(driveHelper).toMatch(/Observability must never block marking the job completed/);
    expect(driveHelper).toMatch(/runtime_stage: "completing"/);
    expect(driveHelper).toMatch(/runtime_stage: "parsing_started"/);
  });

  test("registry list avoids heavy job embeds and false zero UI", () => {
    expect(vaultApi).toMatch(/fetchVaultKnowledgeStats/);
    expect(vaultApi).toMatch(/includeRelations/);
    expect(vaultApi).toMatch(/count: "exact", head: true/);
    expect(panel).toMatch(/Knowledge registry unavailable/);
    expect(panel).toMatch(/registryUnavailable/);
    expect(panel).toMatch(/fetchVaultKnowledgeStats/);
  });

  test("process_run processes one run per client invocation", () => {
    expect(vaultApi).toMatch(/Process one run per Edge invocation/);
    expect(driveFunction).toMatch(/PROCESS_RUN_BUDGET_MS/);
    expect(driveFunction).toMatch(/includeDiscoveryRoots/);
  });
});

describe("scheduled Drive ingestion (Phase 2b timeout-safe)", () => {
  test("cash_up folders are processed before daily_logbook", () => {
    expect(scheduledIngest).toMatch(/sortScheduledFolders/);
    expect(scheduledIngest).toMatch(/cash_up: 0/);
    expect(scheduledIngest).toMatch(/daily_logbook: 1/);
    expect(scheduledIngest).toMatch(/scheduledFolderPriority/);
  });

  test("scheduled ingest supports reportType, maxFolders, and maxFilesPerRun limits", () => {
    expect(driveFunction).toMatch(/reportType: body\?\.reportType/);
    expect(driveFunction).toMatch(/reportTypes: Array\.isArray\(body\?\.reportTypes\)/);
    expect(driveFunction).toMatch(/maxFolders: body\?\.maxFolders/);
    expect(driveFunction).toMatch(/maxFilesPerRun: body\?\.maxFilesPerRun/);
    expect(scheduledIngest).toMatch(/filterScheduledFolders/);
    expect(scheduledIngest).toMatch(/maxFolders \? eligible\.slice\(0, maxFolders\)/);
    expect(scheduledIngest).toMatch(/maxFilesToProcess: maxFilesPerRun/);
    expect(scheduledIngest).toMatch(/SCHEDULED_MAX_FILES_DEFAULT = 25/);
    expect(scheduledIngest).toMatch(/SCHEDULED_PRIORITY_REPORT_TYPES/);
    expect(scheduledIngest).toMatch(/cash_up/);
    expect(scheduledIngest).toMatch(/daily_logbook/);
  });

  test("scheduled ingest returns partial 200 within strict time budget", () => {
    expect(scheduledIngest).toMatch(/SCHEDULED_INGEST_BUDGET_MS = 50_000/);
    expect(scheduledIngest).toMatch(/SCHEDULED_BUDGET_RESERVE_MS/);
    expect(scheduledIngest).toMatch(/budgetExhausted/);
    expect(scheduledIngest).toMatch(/time_budget_exhausted/);
    expect(scheduledIngest).toMatch(/remaining_files/);
    expect(scheduledIngest).toMatch(/finalizeScheduledRunStop/);
    expect(scheduledIngest).toMatch(/partial: true/);
  });

  test("stuck scheduled runs in running are cleaned up before processing", () => {
    expect(scheduledIngest).toMatch(/cleanupStuckScheduledRuns/);
    expect(scheduledIngest).toMatch(/scheduled_worker_aborted/);
    expect(scheduledIngest).toMatch(/SCHEDULED_STUCK_RUN_MINUTES = 15/);
    expect(scheduledIngest).toMatch(/stuckRunsCleaned/);
    expect(scheduledIngest).toMatch(/\.in\("status", \["running", "queued"\]\)/);
    expect(scheduledIngest).toMatch(/stale_run_reconciled/);
  });

  test("scheduled ingest avoids worker-kill style long loops", () => {
    expect(scheduledIngest).toMatch(/SCHEDULED_MAX_LOOP_ATTEMPTS = 1/);
    expect(scheduledIngest).not.toMatch(/SCHEDULED_MAX_LOOP_ATTEMPTS = 5/);
    expect(scheduledIngest).not.toMatch(/SCHEDULED_INGEST_TIMEOUT_MS = 110_000/);
  });

  test("concurrency lock skips active folder runs", () => {
    expect(scheduledIngest).toMatch(/folderHasActiveIngestionRun/);
    expect(scheduledIngest).toMatch(/concurrency_lock/);
    expect(driveHelper).toMatch(/already \$\{activeRun\.status\}/);
    expect(driveHelper).toMatch(/double-ingest/);
  });

  test("token refresh failure marks reconnect_required on connection", () => {
    expect(driveFunction).toMatch(/status: "reconnect_required"/);
    expect(driveFunction).toMatch(/tokens\.refresh_token \|\| existingConn\?\.refresh_token/);
    expect(driveFunction).toMatch(/reconnect_required/);
    expect(driveFunction).toMatch(/CONNECTION_REQUIRED/);
    expect(scheduledIngest).toMatch(/connection_required/);
    expect(panel).toMatch(/CONNECTION REQUIRED/);
    expect(panel).toMatch(/Last automatic sync/);
    expect(panel).toMatch(/Next sync/);
    expect(panel).toMatch(/formatRiyadhSchedule/);
  });

  test("Asia/Riyadh 03:00 schedule uses 00:00 UTC cron", () => {
    const cronMigration = fs.readFileSync(
      path.join(root, "supabase/migrations/20260809030000_drive_cashup_logbook_daily_cron.sql"),
      "utf8",
    );
    expect(cronMigration).toMatch(/'0 0 \* \* \*'/);
    expect(cronMigration).toMatch(/03:00 Asia\/Riyadh/);
    expect(cronMigration).toMatch(/cash_up/);
    expect(cronMigration).toMatch(/daily_logbook/);
    expect(cronMigration).toMatch(/reconnect_required/);
    expect(driveFunction).toMatch(/cronUtc: "0 0 \* \* \*"/);
    expect(driveFunction).toMatch(/timezone: "Asia\/Riyadh"/);
  });
});

