import { readFileSync } from "fs";
import path from "path";

const INGESTION_MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260608120000_ask_nac_vault_ingestion_system.sql",
);

const FIX_MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260608210000_ask_nac_bulk_import_batches_rls_fix.sql",
);

describe("ask_nac_bulk_import_batches RLS", () => {
  let ingestionSql;
  let fixSql;

  beforeAll(() => {
    ingestionSql = readFileSync(INGESTION_MIGRATION, "utf8");
    fixSql = readFileSync(FIX_MIGRATION, "utf8");
  });

  test("insert policy is ask_nac_bulk_batches_insert on ask_nac_bulk_import_batches", () => {
    expect(ingestionSql).toMatch(
      /create policy ask_nac_bulk_batches_insert on public\.ask_nac_bulk_import_batches[\s\S]*for insert to authenticated/,
    );
  });

  test("failing policy requires vault upload permission and uploader email match", () => {
    const insertPolicy = ingestionSql.match(
      /create policy ask_nac_bulk_batches_insert on public\.ask_nac_bulk_import_batches[\s\S]*?;/,
    )?.[0];
    expect(insertPolicy).toBeTruthy();
    expect(insertPolicy).toMatch(/public\.ask_nac_vault_can_upload\(\)/);
    expect(insertPolicy).toMatch(/lower\(uploader_email\) = public\.ask_nac_vault_auth_email\(\)/);
  });

  test("fix extends ask_nac_vault_can_upload for menu staff editors", () => {
    expect(fixSql).toMatch(/create or replace function public\.ask_nac_vault_can_upload\(\)/);
    expect(fixSql).toMatch(/public\.nac_menu_staff_all_branches\(\)/);
    expect(fixSql).toMatch(/menu_staff_scope[\s\S]*branch_gm/);
  });

  test("fix aligns ask_nac_vault_auth_email with menu JWT email fallback", () => {
    expect(fixSql).toMatch(/request\.jwt\.claim\.email/);
    expect(fixSql).toMatch(/auth\.jwt\(\) ->> 'email'/);
  });
});
