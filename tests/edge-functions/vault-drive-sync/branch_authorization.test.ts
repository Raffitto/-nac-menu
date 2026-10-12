/**
 * F15 regression: user-triggered vault-drive-sync actions run with a service-role client, so the
 * handler must enforce the role/branch model before registering folders or queueing/processing
 * ingestion. Since S1.2 the user path uses the same per-owner rule as the nightly job
 * (vaultDriveOwnerAuthorization.ts). Real handler, offline stubs.
 */
import { assert, assertEquals } from "../assert.ts";
import { call, SCHED_SECRET, state } from "../harness.ts";
import { table } from "../stubs/state.ts";
import { bearer, seedFolder, seedIdentities, U } from "../fixtures.ts";

function seed() {
  seedIdentities();
  seedFolder("f-khobar", U.khobarGm, "khobar");
  seedFolder("f-riyadh-by-khobar-gm", U.khobarGm, "riyadh"); // legacy row registered before the fix
  seedFolder("f-riyadh", U.riyadhGm, "riyadh");
  seedFolder("f-staff-jeddah", U.staff, "jeddah");
  seedFolder("f-ceo-brand", U.ceo, null);
  seedFolder("f-ceo-jeddah", U.ceo, "jeddah");
}
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

Deno.test("F15-R10 branch ACCESS without can_upload cannot register (mutation-gap guard)", async () => {
  seed();
  const r = await register(U.branchNoUpload, { branchId: "khobar" });
  assertEquals(r.status, 403, JSON.stringify(r.body));
  assertEquals(folderWrites().length, 0);
});

Deno.test("F15-R11 'restricted' NAC OS menu role on a branch cannot register", async () => {
  seed();
  const r = await register(U.restrictedMenu, { branchId: "khobar" });
  assertEquals(r.status, 403);
  assertEquals(folderWrites().length, 0);
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

Deno.test("F15-S8 branch ACCESS without can_upload cannot trigger ingest (mutation-gap guard)", async () => {
  seed();
  seedFolder("f-bnu-khobar", U.branchNoUpload, "khobar");
  const r = await call({ action: "sync_ingest" }, bearer(U.branchNoUpload));
  assertEquals(r.status, 403);
  assertEquals([state.createdRuns.length, state.reviewTrackingResolves.length], [0, 0]);
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

// ── S1.2 / Sentinel X1: one per-owner, per-branch rule on the user path ─────
function seedX1() {
  seed();
  for (const u of [U.x1Primary, U.x1Access]) {
    seedFolder(`x1-khobar-${u.token}`, u, "khobar");
    seedFolder(`x1-riyadh-${u.token}`, u, "riyadh"); // legacy / directly-written Riyadh row
    table("ask_nac_drive_sync_folders").push({
      id: `x1-root-riyadh-${u.token}`, connection_id: `conn-${u.token}`, drive_folder_id: `root-r-${u.token}`,
      folder_name: "Daily", branch_id: "riyadh", default_branch_id: "riyadh", enabled: true, is_discovery_root: true,
    });
    table("ask_nac_drive_sync_runs").push({ id: `run-riyadh-${u.token}`, folder_id: `x1-riyadh-${u.token}`, stats: {} });
    table("ask_nac_drive_sync_runs").push({ id: `run-khobar-${u.token}`, folder_id: `x1-khobar-${u.token}`, stats: {} });
  }
}
const runsOn = (prefix: string) => state.createdRuns.filter((x) => String(x.folderId).startsWith(prefix));

for (const [label, u] of [["primary=riyadh", U.x1Primary], ["access=riyadh", U.x1Access]] as const) {
  Deno.test(`X1-R Khobar GM with Riyadh vault ${label} cannot register a Riyadh folder`, async () => {
    seedX1();
    for (const extra of [{ branchId: "riyadh" }, { branchId: "khobar", defaultBranchId: "riyadh" }, { defaultBranchId: "Riyadh" }]) {
      const r = await register(u, extra);
      assertEquals(r.status, 403, `${JSON.stringify(extra)} -> ${JSON.stringify(r.body)}`);
    }
    assertEquals(folderWrites().length, 0);
    assertEquals(state.rpcCalls.length, 0, "user path must not consult the widened RPCs");
  });

  Deno.test(`X1-P Khobar GM with Riyadh vault ${label} cannot process a Riyadh run`, async () => {
    seedX1();
    const r = await call({ action: "process_run", runId: `run-riyadh-${u.token}` }, bearer(u));
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(state.processedRuns.length, 0);
    assertEquals(r.body?.processedRuns?.[0]?.reason, "not_authorized_for_branch");
  });

  Deno.test(`X1-S Khobar GM with Riyadh vault ${label}: sync_ingest/retry never touch Riyadh`, async () => {
    seedX1();
    const one = await call({ action: "sync_ingest", folderId: `x1-riyadh-${u.token}` }, bearer(u));
    assertEquals(one.status, 403);
    const retry = await call({ action: "retry_file", folderId: `x1-riyadh-${u.token}`, driveFileId: "f1" }, bearer(u));
    assertEquals(retry.status, 403);
    assertEquals(state.createdRuns.length, 0);
    const all = await call({ action: "sync_ingest" }, bearer(u));
    assertEquals(all.status, 202, JSON.stringify(all.body));
    assertEquals(runsOn("x1-").map((x) => x.folderId), [`x1-khobar-${u.token}`]); // own branch still works
    assertEquals(state.processedRuns.filter((x) => String(x.folderId).includes("riyadh")).length, 0);
  });

  Deno.test(`X1-D Khobar GM with Riyadh vault ${label}: discover_folders ignores the Riyadh root`, async () => {
    seedX1();
    const r = await call({ action: "discover_folders" }, bearer(u));
    assertEquals(r.status, 403, JSON.stringify(r.body));
    assertEquals(state.writes.filter((w) => w.table === "ask_nac_drive_discovery_candidates").length, 0);
  });

  Deno.test(`X1-OK Khobar GM with Riyadh vault ${label} keeps own-branch flows (register, process, connect)`, async () => {
    seedX1();
    const reg = await register(u, { branchId: "khobar" });
    assertEquals([reg.status, reg.body?.folder?.branch_id], [200, "khobar"]);
    const p = await call({ action: "process_run", runId: `run-khobar-${u.token}` }, bearer(u));
    assertEquals(p.status, 200, JSON.stringify(p.body));
    assertEquals(state.processedRuns.map((x) => x.folderId), [`x1-khobar-${u.token}`]);
    const a = await call({ action: "authorize", redirectUri: "https://example.invalid/cb" }, bearer(u));
    assertEquals(a.status, 200);
  });
}

Deno.test("X1-REG legitimate GM / CEO / developer flows still work on the user path", async () => {
  seed();
  seedFolder("f-dev-riyadh", U.developer, "riyadh");
  seedFolder("f-dev-brand", U.developer, null);
  const cases: Array<[typeof U.ceo, Record<string, unknown>]> = [
    [U.khobarGm, { branchId: "khobar" }], [U.riyadhGm, { branchId: "riyadh" }], [U.menuOnlyGm, { branchId: "khobar" }],
    [U.ceo, { branchId: "riyadh" }], [U.ceo, { branchId: null, autoIngest: false }], [U.developer, { branchId: "jeddah" }], [U.developer, { branchId: null, autoIngest: false }],
  ];
  for (const [u, extra] of cases) {
    const r = await register(u, { ...extra, folderId: `drive-${u.token}-${extra.branchId}` });
    assertEquals(r.status, 200, `${u.email} ${JSON.stringify(extra)} -> ${JSON.stringify(r.body)}`);
  }
  const dev = await call({ action: "sync_ingest" }, bearer(U.developer));
  assertEquals(dev.status, 202, JSON.stringify(dev.body));
  assertEquals(state.createdRuns.filter((x) => String(x.folderId).startsWith("f-dev")).map((x) => x.folderId).sort(), ["f-dev-brand", "f-dev-riyadh"]);
  assertEquals(state.reviewTrackingResolves.map((x) => x.branchId), ["khobar"]);
  for (const u of [U.khobarGm, U.ceo, U.developer, U.menuOnlyGm]) {
    assertEquals((await call({ action: "authorize", redirectUri: "https://example.invalid/cb" }, bearer(u))).status, 200, u.email);
  }
});

Deno.test("X2 menu_staff_scope email case does not matter on the user path", async () => {
  seed();
  const r = await register(U.upperGm, { branchId: "khobar" });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals((await register(U.upperGm, { branchId: "riyadh", folderId: "drive-x" })).status, 403);
});

Deno.test("X1-FC user path fails closed when staff tables cannot be read", async () => {
  seed();
  for (const t of ["ask_nac_staff", "ask_nac_roles", "ask_nac_user_branch_access", "menu_staff_scope"]) state.failTables.add(t);
  assertEquals((await register(U.ceo, { branchId: "khobar" })).status, 403);
  assertEquals((await call({ action: "sync_ingest" }, bearer(U.ceo))).status, 403);
  assertEquals((await call({ action: "authorize", redirectUri: "https://example.invalid/cb" }, bearer(U.ceo))).status, 403);
  assertEquals([folderWrites().length, state.createdRuns.length], [0, 0]);
});
