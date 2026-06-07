import { readFileSync } from "fs";
import path from "path";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260606120000_ask_nac_data_vault_foundation.sql",
);
const INGESTION_MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260606140000_ask_nac_vault_ingestion_policies.sql",
);
const COVERAGE_MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260606150000_ask_nac_vault_parser_coverage.sql",
);
const HARDENING_MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260606200000_ask_nac_vault_permission_hardening.sql",
);

describe("vault registry QA (static migration checks)", () => {
  let foundationSql;
  let ingestionSql;

  beforeAll(() => {
    foundationSql = readFileSync(MIGRATION_PATH, "utf8");
    ingestionSql = readFileSync(INGESTION_MIGRATION_PATH, "utf8");
  });

  test("foundation migration defines private vault bucket", () => {
    expect(foundationSql).toMatch(/ask-nac-vault-originals/);
    expect(foundationSql).toMatch(/'ask-nac-vault-originals'[\s\S]*?\n\s*false,/);
  });

  test("foundation migration creates registry + pipeline tables", () => {
    for (const table of [
      "ask_nac_files",
      "ask_nac_file_versions",
      "ask_nac_ingestion_jobs",
      "ask_nac_staff",
      "ask_nac_structured_facts",
      "ask_nac_data_coverage",
    ]) {
      expect(foundationSql).toMatch(new RegExp(`create table if not exists public\\.${table}`));
    }
  });

  test("foundation migration enables RLS helpers and file policies", () => {
    expect(foundationSql).toMatch(/ask_nac_vault_can_read_file/);
    expect(foundationSql).toMatch(/ask_nac_files_select/);
    expect(foundationSql).toMatch(/ask_nac_vault_storage_insert/);
  });

  test("foundation seeds map menu users to vault roles", () => {
    expect(foundationSql).toMatch(/'branch_manager', 'khobar', 'branch_gm'/);
    expect(foundationSql).toMatch(/'ceo', null, 'ceo'/);
    expect(foundationSql).toMatch(/'super_admin', null, 'developer'/);
  });

  test("ingestion migration adds fact insert + job update policies", () => {
    expect(ingestionSql).toMatch(/ask_nac_facts_insert/);
    expect(ingestionSql).toMatch(/ask_nac_ingestion_update/);
    expect(ingestionSql).toMatch(/vault-prototype-v1/);
    expect(readFileSync(COVERAGE_MIGRATION_PATH, "utf8")).toMatch(/ccm_reconciliation/);
    expect(readFileSync(COVERAGE_MIGRATION_PATH, "utf8")).toMatch(/vault-prototype-v2/);
  });

  test("permission hardening migration tightens coverage and brand-wide uploads", () => {
    const hardeningSql = readFileSync(HARDENING_MIGRATION_PATH, "utf8");
    expect(hardeningSql).toMatch(/ask_nac_vault_can_read_file\(source_file_id\)/);
    expect(hardeningSql).toMatch(/ask_nac_vault_storage_select/);
  });
});
