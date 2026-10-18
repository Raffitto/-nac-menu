const fs = require("fs");
const path = require("path");

const migration = fs.readFileSync(
  path.join(__dirname, "../../supabase/migrations/20261015160000_menu_event_detail_rollup.sql"),
  "utf8",
);

function menuEventBranchVisible({ authenticated, allBranches, requested, rowBranch, allowed }) {
  if (!authenticated) return false;
  const req = String(requested ?? "").trim().toLowerCase();
  const row = String(rowBranch ?? "").trim().toLowerCase();
  if (allBranches) return req === "" || row === req;
  return req !== "" && row === req && allowed === true;
}

describe("menu event branch visibility", () => {
  test("the rollup refuses an empty or foreign branch unless the user may see every branch", () => {
    expect(menuEventBranchVisible({
      authenticated: false, allBranches: false, requested: "khobar", rowBranch: "khobar", allowed: true,
    })).toBe(false);
    expect(menuEventBranchVisible({
      authenticated: true, allBranches: false, requested: "", rowBranch: "riyadh", allowed: true,
    })).toBe(false);
    expect(menuEventBranchVisible({
      authenticated: true, allBranches: false, requested: null, rowBranch: "khobar", allowed: true,
    })).toBe(false);
    expect(menuEventBranchVisible({
      authenticated: true, allBranches: false, requested: "riyadh", rowBranch: "riyadh", allowed: false,
    })).toBe(false);
    expect(menuEventBranchVisible({
      authenticated: true, allBranches: false, requested: "khobar", rowBranch: "riyadh", allowed: true,
    })).toBe(false);
    expect(menuEventBranchVisible({
      authenticated: true, allBranches: false, requested: "khobar", rowBranch: "khobar", allowed: true,
    })).toBe(true);
    expect(menuEventBranchVisible({
      authenticated: true, allBranches: true, requested: "", rowBranch: "jeddah", allowed: false,
    })).toBe(true);
  });

  test("the migration enforces that rule inside the security-definer summary", () => {
    expect(migration).toMatch(/auth\.uid\(\) is not null/);
    expect(migration).toMatch(/ask_nac_vault_branch_allowed\(p_requested\)/);
    expect(migration).toMatch(/ask_nac_vault_has_all_branches\(\)/);
    expect(migration).toMatch(/menu_event_branch_visible\(p_branch, d\.branch_id\)/);
    expect(migration).toMatch(/menu_event_branch_visible\(p_branch, r\.branch_id\)/);
    expect(migration).not.toMatch(/p_branch is null\s+or btrim\(p_branch\) = ''/);
    expect(migration).toMatch(/revoke all on function public\.menu_event_branch_visible\(text, text\) from authenticated/);
  });
});
