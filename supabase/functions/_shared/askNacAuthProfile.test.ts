import assert from "node:assert/strict";
import { loadAskNacAuthProfileHint } from "./askNacAuthProfile.ts";
import { getFoodicsTopItems } from "./askNacFoodicsTools.ts";
import { getVaultCoverage } from "./askNacVaultTools.ts";

const ESCALATION_HINT = {
  role: "ceo",
  allBranches: true,
  branchScope: "riyadh",
  allowedBranchIds: ["khobar", "riyadh", "jeddah"],
};

function supabaseFor(staff: { data: unknown; error: unknown }, access: { data: unknown; error: unknown }, rpc: { data: unknown; error: unknown }) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const payload = table === "ask_nac_staff" ? staff : access;
      const api = {
        select() { return api; },
        eq() { return api; },
        lte() { return api; },
        gte() { return api; },
        in() { return api; },
        order() { return api; },
        limit() { return api; },
        neq() { return api; },
        maybeSingle() { return Promise.resolve(payload); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(payload).then(resolve, reject);
        },
      };
      return api;
    },
    rpc(name: string) {
      calls.push(`rpc:${name}`);
      return Promise.resolve(rpc);
    },
  };
}

Deno.test("client branch settings cannot expand a Khobar staff record", async () => {
  const supabase = supabaseFor(
    { data: { vault_role: "branch_manager", primary_branch_id: "khobar" }, error: null },
    { data: [{ branch_id: "khobar" }], error: null },
    { data: false, error: null },
  );
  const loaded = await loadAskNacAuthProfileHint(supabase as never, ESCALATION_HINT);
  assert.equal(loaded.profileHint.allBranches, false);
  assert.equal(loaded.profileHint.authenticated, true);
  assert.deepEqual(loaded.profileHint.allowedBranchIds, ["khobar"]);
  assert.equal(loaded.profileHint.branchScope, "khobar");
  assert.equal(loaded.profileHint.role, "branch_manager");
  assert.equal(loaded.diagnostics.clientAllBranches, true);
  assert.equal(loaded.profileHint.allowedBranchIds?.includes("riyadh"), false);
});

Deno.test("missing staff and branch grants deny; an explicit company-wide RPC stays allowed", async () => {
  const missing = supabaseFor(
    { data: null, error: null },
    { data: [], error: null },
    { data: false, error: null },
  );
  const denied = await loadAskNacAuthProfileHint(missing as never, ESCALATION_HINT);
  assert.equal(denied.profileHint.authenticated, false);
  assert.equal(denied.profileHint.allBranches, false);
  assert.deepEqual(denied.profileHint.allowedBranchIds, []);

  const company = supabaseFor(
    { data: null, error: null },
    { data: [], error: null },
    { data: true, error: null },
  );
  const allowed = await loadAskNacAuthProfileHint(company as never, { allBranches: false, branchScope: "jeddah" });
  assert.equal(allowed.profileHint.allBranches, true);
  assert.equal(allowed.profileHint.authenticated, true);
  assert.equal(allowed.profileHint.branchScope, null);
});

Deno.test("a denied Foodics and coverage read does not query those tables", async () => {
  const supabase = supabaseFor(
    { data: null, error: null },
    { data: [], error: null },
    { data: false, error: null },
  );
  supabase.calls.length = 0;
  const profile = {
    authenticated: true,
    allBranches: false,
    branchScope: "khobar",
    allowedBranchIds: ["khobar"],
  };
  const top = await getFoodicsTopItems(supabase as never, {
    profile,
    branchMention: "riyadh",
    foodicsPeriod: { startDate: "2026-10-01", endDate: "2026-10-07", label: "last 7 days" },
  });
  const coverage = await getVaultCoverage(supabase as never, {
    profile,
    branch: "riyadh",
    branchMention: "riyadh",
    reportType: "cash_up",
    startDate: "2026-10-01",
    endDate: "2026-10-07",
  });
  assert.equal(top.authorizationDenied, true);
  assert.equal(coverage.authorizationDenied, true);
  assert.deepEqual(supabase.calls, []);
});
