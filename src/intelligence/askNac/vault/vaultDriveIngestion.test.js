const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260617193000_ask_nac_drive_ingestion.sql"),
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
    expect(migration).toMatch(/folders_scanned/);
    expect(migration).toMatch(/max_depth/);
    expect(migration).toMatch(/downloaded_count/);
    expect(migration).toMatch(/indexed_count/);
    expect(migration).toMatch(/current_file text/);
  });

  test("records per-file Drive failures for System Details and retry", () => {
    expect(migration).toMatch(/create table if not exists public\.ask_nac_drive_sync_run_files/);
    expect(migration).toMatch(/drive_file_id text not null/);
    expect(migration).toMatch(/folder_path text/);
    expect(migration).toMatch(/relative_path text/);
    expect(migration).toMatch(/depth int not null default 0/);
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
    expect(driveHelper).toMatch(/currentDriveFolderId = info\.folderId/);
    expect(driveHelper).toMatch(/current_file: `Scanning \$\{info\.folderPath\}`/);
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
    expect(driveHelper).toMatch(/folder_path: driveFile\.folderPath/);
    expect(driveHelper).toMatch(/relative_path: driveFile\.relativePath/);
    expect(driveHelper).toMatch(/current_file: driveFile\.relativePath/);
    expect(driveHelper).toMatch(/notes: `Imported from Google Drive path/);
    expect(panel).toMatch(/file\.relative_path \|\| file\.file_name/);
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
});

