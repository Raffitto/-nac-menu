/**
 * F15 regression: user-triggered vault-drive-sync actions run with a service-role client, so the
 * handler must enforce the existing role/branch model (ask_nac_vault_* and nac_menu_* helpers)
 * before registering folders or queueing/processing ingestion. Real handler, offline stubs.
 */
import { assert, assertEquals } from "../assert.ts";
import { call, resetState, SCHED_SECRET, state } from "../harness.ts";
import { table } from "../stubs/state.ts";

const U = {
  ceo: { token: "tok-ceo", email: "ceo@test.local" },
  khobarGm: { token: "tok-khobar-gm", email: "khobar-gm@test.local" },
  riyadhGm: { token: "tok-riyadh-gm", email: "riyadh-gm@test.local" },
  menuOnlyGm: { token: "tok-menu-gm", email: "menu-gm@test.local" },
  staff: { token: "tok-staff", email: "staff@test.local" },
  unmapped: { token: "tok-unmapped", email: "unmapped@test.local" },
};
const only = (b: string) => (a: Record<string, unknown>) => a.p_branch === b;

function seed() {
  resetState();
  for (const u of Object.values(U)) state.users[u.token] = u.email;
  state.perms[U.ceo.email] = {
    ask_nac_vault_can_upload: true, ask_nac_vault_has_all_branches: true, nac_menu_staff_all_branches: true,
    ask_nac_vault_branch_allowed: true, nac_menu_can_edit_branch: true,
  };
  state.perms[U.khobarGm.email] = {
    ask_nac_vault_can_upload: true, ask_nac_vault_has_all_branches: false, nac_menu_staff_all_branches: false,
    ask_nac_vault_branch_allowed: only("khobar"), nac_menu_can_edit_branch: only("khobar"),
  };
  state.perms[U.riyadhGm.email] = {
    ask_nac_vault_can_upload: true, ask_nac_vault_has_all_branches: false, nac_menu_staff_all_branches: false,
    ask_nac_vault_branch_allowed: only("riyadh"), nac_menu_can_edit_branch: only("riyadh"),
  };
  // NAC OS RBAC branch_gm not mapped in ask_nac_staff: vault branch check false, menu scope true.
  state.perms[U.menuOnlyGm.email] = {
    ask_nac_vault_can_upload: true, ask_nac_vault_has_all_branches: false, nac_menu_staff_all_branches: false,
    ask_nac_vault_branch_allowed: false, nac_menu_can_edit_branch: only("khobar"),
  };
  state.perms[U.staff.email] = {
    ask_nac_vault_can_upload: false, ask_nac_vault_has_all_branches: false, nac_menu_staff_all_branches: false,
    ask_nac_vault_branch_allowed: false, nac_menu_can_edit_branch: false,
  };
  // U.unmapped: no RPC results at all -> every RPC errors -> must fail closed.
  for (const u of Object.values(U)) {
    table("ask_nac_drive_connections").push({ id: `conn-${u.token}`, user_email: u.email, refresh_token: `rt-${u.token}`, status: "active" });
  }
  const folder = (id: string, owner: { token: string }, branch: string | null, extra = {}) =>
    table("ask_nac_drive_sync_folders").push({
      id, connection_id: `conn-${owner.token}`, drive_folder_id: `drive-${id}`, folder_name: id, label: id,
      branch_id: branch, default_branch_id: branch, department: "operations", report_type: "cash_up",
      auto_ingest: true, enabled: true, is_discovery_root: false, ...extra,
    });
  folder("f-khobar", U.khobarGm, "khobar");
  folder("f-riyadh-by-khobar-gm", U.khobarGm, "riyadh"); // legacy row registered before the fix
  folder("f-riyadh", U.riyadhGm, "riyadh");
  folder("f-staff-jeddah", U.staff, "jeddah");
  folder("f-ceo-brand", U.ceo, null);
  folder("f-ceo-jeddah", U.ceo, "jeddah");
}
const bearer = (u: { token: string }) => `Bearer ${u.token}`;
const folderWrites = () => state.writes.filter((w) => w.table === "ask_nac_drive_sync_folders");
const register = (u: { token: string }, extra: Record<string, unknown>) =>
  call({ action: "register_folder", folderId: "drive-new", folderName: "Cash Up", autoIngest: true, ...extra }, bearer(u));

// ── register_folder ─────────────────────────────────────────────────────────
Deno.test("F15-R1 authorized branch GM registers a folder for own branch", async () => {
  seed();
  const r = await register(U.khobarGm, { branchId: "khobar" });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals([r.body?.folder?.branch_id, r.body?.folder?.default_branch_id], ["khobar", "khobar"]);
});

Deno.test("F15-R2 branch GM cannot register a folder against ANOTHER branch", async () => {
  seed();
  const r = await register(U.khobarGm, { branchId: "riyadh" });
  assertEquals(r.status, 403);
  assertEquals(folderWrites().length, 0);
});

Deno.test("F15-R3 mixed branchId/defaultBranchId cannot smuggle a foreign branch", async () => {
  seed();
  const r = await register(U.khobarGm, { branchId: "khobar", defaultBranchId: "riyadh" });
  assertEquals(r.status, 403);
  assertEquals(folderWrites().length, 0);
});

Deno.test("F15-R4 authenticated user without ingestion rights is rejected", async () => {
  seed();
  const r = await register(U.staff, { branchId: "jeddah" });
  assertEquals(r.status, 403);
  assertEquals(folderWrites().length, 0);
});

Deno.test("F15-R5 RPC failure / unmapped user fails closed", async () => {
  seed();
  const r = await register(U.unmapped, { branchId: "khobar" });
  assertEquals(r.status, 403);
  assertEquals(folderWrites().length, 0);
});

Deno.test("F15-R6 brand-wide (no branch) requires cross-branch/brand authority", async () => {
  seed();
  const gm = await register(U.khobarGm, { branchId: null, autoIngest: false });
  assertEquals(gm.status, 403);
  const ceo = await register(U.ceo, { branchId: null, autoIngest: false });
  assertEquals(ceo.status, 200, JSON.stringify(ceo.body));
  assertEquals(ceo.body?.folder?.branch_id, null);
});

Deno.test("F15-R7 unknown branch id is rejected", async () => {
  seed();
  const r = await register(U.ceo, { branchId: "atlantis" });
  assertEquals(r.status, 400);
  assertEquals(folderWrites().length, 0);
});

Deno.test("F15-R8 NAC OS RBAC branch_gm (menu scope only) is honoured for own branch", async () => {
  seed();
  assertEquals((await register(U.menuOnlyGm, { branchId: "khobar" })).status, 200);
  assertEquals((await register(U.menuOnlyGm, { branchId: "riyadh", folderId: "drive-other" })).status, 403);
});

Deno.test("F15-R9 branch spelling variants normalise like nac_normalize_branch_id", async () => {
  seed();
  const r = await register(U.khobarGm, { branchId: "Al Khobar" });
  assertEquals([r.status, r.body?.folder?.branch_id], [200, "khobar"]);
});

// ── sync_ingest / retry_file ───────────────────────────────────────────────
Deno.test("F15-S1 sync_ingest queues only folders of branches the caller is authorized for", async () => {
  seed();
  const r = await call({ action: "sync_ingest" }, bearer(U.khobarGm));
  assertEquals(r.status, 202, JSON.stringify(r.body));
  assertEquals(state.createdRuns.map((x) => x.folderId), ["f-khobar"]);
  assertEquals(r.body?.skippedUnauthorized, 1);
  assert(state.createdRuns.every((x) => x.branchId === "khobar"), "no foreign-branch run");
});

Deno.test("F15-S2 sync_ingest of a specific foreign-branch folder is refused", async () => {
  seed();
  const r = await call({ action: "sync_ingest", folderId: "f-riyadh-by-khobar-gm" }, bearer(U.khobarGm));
  assertEquals(r.status, 403);
  assertEquals(state.createdRuns.length, 0);
});

Deno.test("F15-S3 retry_file on a foreign-branch folder is refused", async () => {
  seed();
  const r = await call({ action: "retry_file", folderId: "f-riyadh-by-khobar-gm", driveFileId: "x" }, bearer(U.khobarGm));
  assertEquals(r.status, 403);
  assertEquals(state.createdRuns.length, 0);
});

Deno.test("F15-S4 user without ingestion rights cannot trigger ingest at all", async () => {
  seed();
  const r = await call({ action: "sync_ingest" }, bearer(U.staff));
  assertEquals(r.status, 403);
  assertEquals([state.createdRuns.length, state.reviewTrackingResolves.length], [0, 0]);
});

Deno.test("F15-S5 Khobar-attributed review-tracking discovery only for Khobar-authorized callers", async () => {
  seed();
  const riyadh = await call({ action: "sync_ingest" }, bearer(U.riyadhGm));
  assertEquals(riyadh.status, 202, JSON.stringify(riyadh.body));
  assertEquals(state.createdRuns.map((x) => x.folderId), ["f-riyadh"]);
  assertEquals(state.reviewTrackingResolves.length, 0);
  seed();
  await call({ action: "sync_ingest" }, bearer(U.khobarGm));
  assertEquals(state.reviewTrackingResolves.map((x) => x.branchId), ["khobar"]);
});

Deno.test("F15-S6 cross-branch admin still ingests all own folders (incl. brand-wide)", async () => {
  seed();
  const r = await call({ action: "sync_ingest" }, bearer(U.ceo));
  assertEquals(r.status, 202, JSON.stringify(r.body));
  assertEquals(state.createdRuns.map((x) => x.folderId).sort(), ["f-ceo-brand", "f-ceo-jeddah"]);
});

Deno.test("F15-S7 a user never queues another user's folders", async () => {
  seed();
  await call({ action: "sync_ingest" }, bearer(U.ceo));
  assert(!state.createdRuns.some((x) => ["f-khobar", "f-riyadh", "f-staff-jeddah"].includes(x.folderId)));
});

// ── process_run ────────────────────────────────────────────────────────────
Deno.test("F15-P1 process_run refuses a queued run on a foreign-branch folder", async () => {
  seed();
  table("ask_nac_drive_sync_runs").push({ id: "run-legacy", folder_id: "f-riyadh-by-khobar-gm", stats: {} });
  const r = await call({ action: "process_run", runId: "run-legacy" }, bearer(U.khobarGm));
  assertEquals(r.status, 200);
  assertEquals(state.processedRuns.length, 0);
  assertEquals(r.body?.processedRuns?.[0]?.reason, "not_authorized_for_branch");
});

Deno.test("F15-P2 process_run proceeds for an authorized run", async () => {
  seed();
  table("ask_nac_drive_sync_runs").push({ id: "run-ok", folder_id: "f-khobar", stats: {} });
  const r = await call({ action: "process_run", runId: "run-ok" }, bearer(U.khobarGm));
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(state.processedRuns.map((x) => x.folderId), ["f-khobar"]);
});

// ── discover_folders ───────────────────────────────────────────────────────
Deno.test("F15-D1 discover_folders ignores discovery roots on unauthorized branches", async () => {
  seed();
  table("ask_nac_drive_sync_folders").push({
    id: "root-riyadh", connection_id: `conn-${U.khobarGm.token}`, drive_folder_id: "drive-root-r", folder_name: "Daily",
    branch_id: "riyadh", default_branch_id: "riyadh", enabled: true, is_discovery_root: true,
  });
  const r = await call({ action: "discover_folders" }, bearer(U.khobarGm));
  assertEquals(r.status, 403);
  assertEquals(state.writes.filter((w) => w.table === "ask_nac_drive_discovery_candidates").length, 0);
});

// ── nightly path unaffected ────────────────────────────────────────────────
Deno.test("F15-N1 nightly scheduled_ingest is unaffected by user authorization", async () => {
  seed();
  const r = await call({ action: "scheduled_ingest" }, `Bearer ${SCHED_SECRET}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(state.reviewTrackingIngests, [{ triggerType: "scheduled" }]);
  assertEquals(state.rpcCalls.length, 0);
});
