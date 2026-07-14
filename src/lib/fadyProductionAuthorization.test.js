import fs from "fs";
import path from "path";

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260714170000_fady_khobar_ops_and_verified_menu_publish.sql",
  ),
  "utf8",
);
const vaultAdminMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260714180000_khobar_vault_admin_scope.sql",
  ),
  "utf8",
);
const askNacEdge = fs.readFileSync(
  path.join(process.cwd(), "supabase/functions/ask-nac/index.ts"),
  "utf8",
);
const productionIdentityMigration = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260714223000_production_staff_identity_scope.sql",
  ),
  "utf8",
);

describe("Fady production authorization migration", () => {
  test("maps the verified account to Khobar admin without global operational access", () => {
    expect(migration).toMatch(
      /\('fady\.aly@nacriyadh\.com', 'khobar', 'branch_gm'\)/,
    );
    expect(migration).toMatch(
      /\('fady\.aly@nacriyadh\.com', 'branch_manager', 'khobar', 'branch_gm'\)/,
    );
    expect(migration).toMatch(
      /\('fady\.aly@nacriyadh\.com', 'khobar', 'admin'\)/,
    );
    expect(migration).not.toMatch(
      /\('fady\.aly@nacriyadh\.com', null, '(developer|ceo)'\)/,
    );
  });

  test("grants an independent network Google Reviews capability", () => {
    expect(migration).toMatch(
      /\('fady\.aly@nacriyadh\.com', 'google_reviews', 'network'/,
    );
    expect(migration).toMatch(
      /nac_has_capability\('google_reviews', 'network'\)/,
    );
    expect(migration).toMatch(
      /review_events_scoped_select[\s\S]*nac_reviews_branch_allowed\(branch_id\)/,
    );
    expect(migration).toMatch(
      /google_review_snapshots_scoped_select[\s\S]*nac_reviews_branch_allowed\(branch_id\)/,
    );
  });

  test("grants full Vault capability only inside Khobar", () => {
    expect(vaultAdminMigration).toMatch(/'branch_admin'[\s\S]*'hr_restricted'[\s\S]*false[\s\S]*true/);
    expect(vaultAdminMigration).toMatch(
      /where lower\(email\) = 'fady\.aly@nacriyadh\.com'/,
    );
    expect(vaultAdminMigration).toMatch(
      /ask_nac_drive_discovery_candidates_write[\s\S]*ask_nac_vault_branch_allowed\(branch_id\)/,
    );
    expect(vaultAdminMigration).toMatch(
      /'branch_admin',[\s\S]*'hr_restricted',\s*false,\s*true/,
    );
  });

  test("maps verified Ahmed and Armel identities without widening Armel", () => {
    expect(productionIdentityMigration).toMatch(
      /\('a\.zaki@aseel-holding\.com', null, 'ceo'\)/,
    );
    expect(productionIdentityMigration).toMatch(
      /\('a\.bisiau@nacriyadh\.com', 'riyadh', 'branch_gm'\)/,
    );
    expect(productionIdentityMigration).not.toMatch(
      /\('a\.bisiau@nacriyadh\.com', null, '(ceo|developer)'\)/,
    );
  });

  test("secures direct reads and security-definer review RPCs", () => {
    expect(migration).toMatch(
      /get_review_events_summary[\s\S]*nac_reviews_branch_allowed\(e\.branch_id\)/,
    );
    expect(migration).toMatch(
      /get_review_intelligence[\s\S]*nac_reviews_branch_allowed\(e\.branch_id\)/,
    );
    expect(migration).toMatch(
      /revoke all on public\.google_review_snapshots from anon/,
    );
  });

  test("rejects explicit Ask NAC requests outside the authenticated Vault scope", () => {
    expect(askNacEdge).toMatch(/ask_nac_vault_branch_allowed/);
    expect(askNacEdge).toMatch(/return json\(403,[\s\S]*Branch access denied/);
    expect(askNacEdge).not.toMatch(/profileHint[\s\S]*branchAllowed/);
  });

  test("publishes idempotently and only marks live after verification", () => {
    expect(migration).toMatch(/unique \(branch_id, idempotency_key\)/);
    expect(migration).toMatch(/create or replace function public\.publish_menu_branch/);
    expect(migration).toMatch(/create or replace function public\.verify_menu_publication/);
    expect(migration).toMatch(/set status = 'live',[\s\S]*guest_verified_at = now\(\)/);
    expect(migration).toMatch(/snapshot_fingerprint = v_fingerprint/);
  });

  test("preserves immutable history, audit, health, and restore-as-new-version", () => {
    expect(migration).toMatch(/create table if not exists public\.menu_publications/);
    expect(migration).toMatch(/create table if not exists public\.menu_audit_log/);
    expect(migration).toMatch(/create or replace function public\.get_menu_publish_status/);
    expect(migration).toMatch(/create or replace function public\.restore_menu_publication/);
    expect(migration).toMatch(/'restored_from_version'/);
  });
});
