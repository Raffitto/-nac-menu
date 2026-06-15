import { readFileSync } from "fs";
import path from "path";

const STORAGE_FIX_MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260615140000_ask_nac_vault_storage_upload_rls_fix.sql",
);

const STORAGE_FIX_V2_MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260615150000_ask_nac_vault_storage_upload_rls_fix_v2.sql",
);

describe("ask_nac_vault storage upload RLS fix", () => {
  let sql;
  let sqlV2;

  beforeAll(() => {
    sql = readFileSync(STORAGE_FIX_MIGRATION, "utf8");
    sqlV2 = readFileSync(STORAGE_FIX_V2_MIGRATION, "utf8");
  });

  test("defines storage path upload helper aligned with menu staff scope", () => {
    expect(sql).toMatch(/ask_nac_vault_storage_path_upload_allowed/);
    expect(sql).toMatch(/nac_menu_staff_all_branches\(\)/);
    expect(sql).toMatch(/nac_menu_staff_branch\(\)/);
    expect(sql).toMatch(/ask_nac_vault_branch_allowed/);
  });

  test("storage insert requires can_upload and path helper", () => {
    const insertPolicy = sql.match(
      /create policy ask_nac_vault_storage_insert on storage\.objects[\s\S]*?;/,
    )?.[0];
    expect(insertPolicy).toBeTruthy();
    expect(insertPolicy).toMatch(/ask-nac-vault-originals/);
    expect(insertPolicy).toMatch(/ask_nac_vault_can_upload\(\)/);
    expect(insertPolicy).toMatch(/ask_nac_vault_storage_path_upload_allowed\(name\)/);
    expect(insertPolicy).not.toMatch(/ask_nac_vault_branch_allowed\(split_part/);
  });

  test("storage update and delete follow same upload path rules", () => {
    expect(sql).toMatch(/ask_nac_vault_storage_update[\s\S]*ask_nac_vault_storage_path_upload_allowed\(name\)/);
    expect(sql).toMatch(/ask_nac_vault_storage_delete[\s\S]*ask_nac_vault_storage_path_upload_allowed\(name\)/);
  });

  test("does not replace registry-scoped storage select policy", () => {
    expect(sql).not.toMatch(/drop policy if exists ask_nac_vault_storage_select/);
  });
});

describe("ask_nac_vault storage upload RLS fix v2", () => {
  let sql;

  beforeAll(() => {
    sql = readFileSync(STORAGE_FIX_V2_MIGRATION, "utf8");
  });

  test("unifies auth email with auth.users fallback", () => {
    expect(sql).toMatch(/create or replace function public\.nac_os_auth_email\(\)/);
    expect(sql).toMatch(/from auth\.users u/);
    expect(sql).toMatch(/where u\.id = auth\.uid\(\)/);
  });

  test("storage policies qualify objects.name and use consolidated write gate", () => {
    const insertPolicy = sql.match(
      /create policy ask_nac_vault_storage_insert on storage\.objects[\s\S]*?;/,
    )?.[0];
    expect(insertPolicy).toMatch(/ask_nac_vault_storage_object_write_allowed\(objects\.bucket_id, objects\.name\)/);
    expect(sql).toMatch(/f\.storage_path = objects\.name/);
  });

  test("path helper matches branch_gm rows to path branch via menu_staff_scope", () => {
    expect(sql).toMatch(/s\.role = 'branch_gm'[\s\S]*nac_normalize_branch_id\(split_part\(p_object_name/);
  });

  test("includes sql editor debug helper", () => {
    expect(sql).toMatch(/ask_nac_vault_storage_upload_debug/);
  });
});
