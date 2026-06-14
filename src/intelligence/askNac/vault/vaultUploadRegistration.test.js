import { readFileSync } from "fs";
import path from "path";
import { vaultFileRecordFromRegistryRow } from "../../../lib/askNacVaultApi";

const ASK_NAC_VAULT_API = path.resolve(__dirname, "../../../lib/askNacVaultApi.js");

describe("vault upload registration", () => {
  let registerVaultUploadSource;
  let duplicateDetectionSource;

  beforeAll(() => {
    const vaultApiSrc = readFileSync(ASK_NAC_VAULT_API, "utf8");
    registerVaultUploadSource = vaultApiSrc.match(
      /export async function registerVaultUpload[\s\S]*?(?=export async function fetchVaultStaffRole)/,
    )?.[0];
    expect(registerVaultUploadSource).toBeTruthy();

    const duplicateDetectionPath = path.resolve(__dirname, "./vaultDuplicateDetection.js");
    duplicateDetectionSource = readFileSync(duplicateDetectionPath, "utf8");
  });

  test("registerVaultUpload does not use INSERT RETURNING on ask_nac_files", () => {
    expect(registerVaultUploadSource).not.toMatch(
      /\.from\("ask_nac_files"\)[\s\S]*?\.insert\([^)]+\)\s*\.select/,
    );
  });

  test("registerVaultUpload does not use UPDATE RETURNING on ask_nac_files", () => {
    expect(registerVaultUploadSource).not.toMatch(
      /\.from\("ask_nac_files"\)[\s\S]*?\.update\([^)]+\)[\s\S]*?\.select/,
    );
  });

  test("registerVaultUpload delegates ingestion to shared pipeline", () => {
    expect(registerVaultUploadSource).toMatch(/runVaultFileIngestionPipeline\(/);
    expect(registerVaultUploadSource).toMatch(/storedOnly: pipeline\.storedOnly/);
    expect(registerVaultUploadSource).not.toMatch(
      /\.from\("ask_nac_ingestion_jobs"\)[\s\S]*?\.insert\([^)]+\)\s*\.select/,
    );
  });

  test("createFileVersion does not use INSERT RETURNING on ask_nac_file_versions", () => {
    const fn = duplicateDetectionSource.match(
      /export async function createFileVersion[\s\S]*?(?=export async function hashFileForIngestion)/,
    )?.[0];
    expect(fn).toBeTruthy();
    expect(fn).not.toMatch(/\.insert\([^)]+\)\s*\.select/);
    expect(fn).toMatch(/const versionId = crypto\.randomUUID\(\)/);
  });

  test("vaultFileRecordFromRegistryRow preserves ingestion fields from local row", () => {
    const row = {
      id: "file-uuid",
      primary_branch_id: "khobar",
      brand_wide: false,
      department: "operations",
      report_type: "cash_up",
      sensitivity_level: "internal",
      period_start: "2025-05-01",
      period_end: "2025-05-31",
    };
    const record = vaultFileRecordFromRegistryRow(row);
    expect(record.id).toBe("file-uuid");
    expect(record.primary_branch_id).toBe("khobar");
    expect(record.report_type).toBe("cash_up");
    expect(record.period_start).toBe("2025-05-01");
  });
});
