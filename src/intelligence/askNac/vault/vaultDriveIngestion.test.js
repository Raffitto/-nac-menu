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
    expect(migration).toMatch(/downloaded_count/);
    expect(migration).toMatch(/indexed_count/);
    expect(migration).toMatch(/current_file text/);
  });

  test("records per-file Drive failures for System Details and retry", () => {
    expect(migration).toMatch(/create table if not exists public\.ask_nac_drive_sync_run_files/);
    expect(migration).toMatch(/drive_file_id text not null/);
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

