/**
 * F15-c regression: service-role review-tracking ingestion (nightly scheduled_ingest and
 * ingest_review_tracking) and nightly folder ingestion must only use connections whose OWNER is
 * authorized for the target branch; connecting Drive requires ingestion authority.
 * Real handler + real vaultReviewTrackingDriveDiscovery / vaultDriveScheduledIngest /
 * vaultDriveOwnerAuthorization; Drive I/O and Supabase are offline stubs.
 */
import { assert, assertEquals } from "../assert.ts";
import { call, SCHED_SECRET, SERVICE_KEY, state } from "../harness.ts";
import { table } from "../stubs/state.ts";
import { bearer, connId, giveReviewTrackingFile, seedFolder, seedIdentities, U } from "../fixtures.ts";

const processedFolders = () => state.processedRuns.map((r) => r.folderId);
const processedBranches = () =>
  state.processedRuns.map((r) => table("ask_nac_drive_sync_folders").find((f) => f.id === r.folderId)?.branch_id ?? null);
const foldersOf = (u: { token: string }) => table("ask_nac_drive_sync_folders").filter((f) => f.connection_id === connId(u));
const connectionWritesOf = (u: { token: string }) =>
  state.writes.filter((w) => w.table === "ask_nac_drive_connections" && w.row.id === connId(u));

function seedReviewTracking() {
  seedIdentities();
  giveReviewTrackingFile(U.khobarGm, "rt-khobar", "parent-khobar");
  giveReviewTrackingFile(U.staff, "rt-staff", "parent-staff");             // no ingestion rights
  giveReviewTrackingFile(U.branchNoUpload, "rt-bnu", "parent-bnu");       // branch access, no can_upload
  giveReviewTrackingFile(U.riyadhGm, "rt-riyadh", "parent-riyadh");       // authorized, but not for Khobar
}

for (const [label, auth, body] of [
  ["nightly scheduled_ingest", `Bearer ${SCHED_SECRET}`, { action: "scheduled_ingest" }],
  ["ingest_review_tracking (service key)", `Bearer ${SERVICE_KEY}`, { action: "ingest_review_tracking" }],
  ["ingest_review_tracking (scheduled secret)", `Bearer ${SCHED_SECRET}`, { action: "ingest_review_tracking" }],
] as const) {
  Deno.test(`F15-C1 ${label}: only Khobar-authorized owners' review tracking is ingested`, async () => {
    seedReviewTracking();
    const r = await call(body, auth);
    assertEquals(r.status, 200, JSON.stringify(r.body));
    // authorized Khobar owner: host folder created as khobar and the file processed
    const host = foldersOf(U.khobarGm).find((f) => f.drive_folder_id === "parent-khobar");
    assert(host, "authorized owner's host folder created");
    assertEquals([host.branch_id, host.report_type], ["khobar", "google_review_tracking"]);
    assertEquals(processedFolders(), [host.id]);
    assertEquals(processedBranches(), ["khobar"]);
    // unauthorized owners: no host folder, no token refresh / connection writes, nothing processed
    for (const u of [U.staff, U.branchNoUpload, U.riyadhGm]) {
      assertEquals(foldersOf(u).length, 0, `${u.email} host folder`);
      assertEquals(connectionWritesOf(u).length, 0, `${u.email} connection touched`);
    }
  });
}

Deno.test("F15-C2 skipped connections are reported without owner emails", async () => {
  seedReviewTracking();
  const r = await call({ action: "ingest_review_tracking" }, `Bearer ${SERVICE_KEY}`);
  const skipped = (r.body?.reviewTracking || []).filter((x: any) => x.skipped);
  // staff, branchNoUpload, riyadhGm, restrictedMenu, unmapped (ceo / khobarGm / menuOnlyGm are authorized)
  assertEquals(skipped.length, 5);
  assert(skipped.every((x: any) => x.skipped === "owner_not_authorized_for_branch" && !("email" in x)));
  // S1.2: no owner email in ANY summary (authorized ones included); responses reach pg_net storage
  const all = r.body?.reviewTracking || [];
  assert(all.some((x: any) => !x.skipped), "has an authorized summary");
  assert(!JSON.stringify(all).includes("@"), "no email in review-tracking summaries");
});

Deno.test("F15-C3 cross-branch admin and NAC OS Khobar branch_gm remain authorized nightly", async () => {
  seedIdentities();
  giveReviewTrackingFile(U.ceo, "rt-ceo", "parent-ceo");
  giveReviewTrackingFile(U.menuOnlyGm, "rt-menu", "parent-menu");
  const r = await call({ action: "scheduled_ingest" }, `Bearer ${SCHED_SECRET}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(processedBranches(), ["khobar", "khobar"]);
});

Deno.test("F15-C4 a legacy foreign-branch row is never re-used as the review-tracking host", async () => {
  seedIdentities();
  giveReviewTrackingFile(U.khobarGm, "rt-khobar", "parent-khobar");
  seedFolder("legacy-riyadh-parent", U.khobarGm, "riyadh", { drive_folder_id: "parent-khobar" });
  await call({ action: "scheduled_ingest" }, `Bearer ${SCHED_SECRET}`);
  assert(!processedFolders().includes("legacy-riyadh-parent"), "must not ingest review tracking via riyadh row");
  const legacy = table("ask_nac_drive_sync_folders").find((f) => f.id === "legacy-riyadh-parent");
  assertEquals([legacy?.branch_id, legacy?.report_type], ["riyadh", "cash_up"]); // not re-labelled
});

Deno.test("F15-C5 user-path sync_ingest never borrows a foreign-branch host folder", async () => {
  seedIdentities();
  giveReviewTrackingFile(U.khobarGm, "rt-khobar", "parent-root");
  seedFolder("f-khobar", U.khobarGm, "khobar");
  seedFolder("legacy-riyadh-parent", U.khobarGm, "riyadh", { drive_folder_id: "parent-root", auto_ingest: false });
  const r = await call({ action: "sync_ingest" }, bearer(U.khobarGm));
  assertEquals(r.status, 202, JSON.stringify(r.body));
  assert(!state.createdRuns.some((x) => x.folderId === "legacy-riyadh-parent"), "no queued run on legacy riyadh row");
});

// ── F15-b at the Edge layer: nightly folder ingestion only for owners authorized for the folder branch
Deno.test("F15-B1 nightly folder ingest skips rows written directly for a branch the owner cannot ingest", async () => {
  seedIdentities();
  seedFolder("direct-staff-riyadh", U.staff, "riyadh");          // e.g. inserted via PostgREST
  seedFolder("direct-bnu-khobar", U.branchNoUpload, "khobar");    // branch access, no can_upload
  seedFolder("gm-foreign", U.khobarGm, "riyadh");                 // legacy foreign-branch row
  seedFolder("gm-own", U.khobarGm, "khobar");
  seedFolder("menu-gm-own", U.menuOnlyGm, "khobar");
  seedFolder("ceo-brand", U.ceo, null);
  const r = await call({ action: "scheduled_ingest", maxFolders: 20 }, `Bearer ${SCHED_SECRET}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  const processed = state.createdRuns.filter((x) => x.triggerType === "scheduled").map((x) => x.folderId).sort();
  assertEquals(processed, ["ceo-brand", "gm-own", "menu-gm-own"]);
  const skipped = (r.body?.folderResults || []).filter((f: any) => f.reason === "owner_not_authorized_for_branch").length;
  assertEquals(skipped, 3);
});

Deno.test("F15-B2 nightly owner authorization fails closed if staff tables cannot be read", async () => {
  seedIdentities();
  seedFolder("gm-own", U.khobarGm, "khobar");
  for (const t of ["ask_nac_staff", "ask_nac_roles", "ask_nac_user_branch_access", "menu_staff_scope"]) state.failTables.add(t);
  const r = await call({ action: "scheduled_ingest" }, `Bearer ${SCHED_SECRET}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(state.createdRuns.length, 0);
  assertEquals(state.processedRuns.length, 0);
});

// ── Connecting Drive requires ingestion authority
for (const u of [U.staff, U.branchNoUpload, U.restrictedMenu, U.unmapped]) {
  Deno.test(`F15-C6 ${u.email} without ingestion authority cannot authorize/callback Drive`, async () => {
    seedIdentities();
    table("ask_nac_drive_connections").splice(0); // nobody connected yet
    const a = await call({ action: "authorize", redirectUri: "https://example.invalid/cb" }, bearer(u));
    assertEquals(a.status, 403);
    const c = await call({ action: "callback", code: "code-1", redirectUri: "https://example.invalid/cb" }, bearer(u));
    assertEquals(c.status, 403);
    assertEquals(table("ask_nac_drive_connections").length, 0);
  });
}

for (const u of [U.khobarGm, U.menuOnlyGm, U.ceo]) {
  Deno.test(`F15-C7 ${u.email} with ingestion authority can connect Drive`, async () => {
    seedIdentities();
    table("ask_nac_drive_connections").splice(0);
    const a = await call({ action: "authorize", redirectUri: "https://example.invalid/cb" }, bearer(u));
    assertEquals(a.status, 200, JSON.stringify(a.body));
    const c = await call({ action: "callback", code: "code-1", redirectUri: "https://example.invalid/cb" }, bearer(u));
    assertEquals(c.status, 200, JSON.stringify(c.body));
    assertEquals(table("ask_nac_drive_connections").map((x) => x.user_email), [u.email]);
  });
}

Deno.test("F15-C8 parent-less hit falls back only to a same-branch folder, never a foreign one", async () => {
  seedIdentities();
  (state.driveFiles["access:rt-tok-khobar-gm"] ??= []).push({ id: "rt-orphan", name: "2026 Review Tracking", parents: [] });
  seedFolder("legacy-riyadh-tracking", U.khobarGm, "riyadh", { report_type: "google_review_tracking", auto_ingest: false });
  seedFolder("legacy-riyadh-root", U.khobarGm, "riyadh", { is_discovery_root: true, auto_ingest: false });
  await call({ action: "ingest_review_tracking" }, `Bearer ${SERVICE_KEY}`);
  assertEquals(state.processedRuns.length, 0, "no same-branch host -> hit skipped");
  seedFolder("gm-khobar-root", U.khobarGm, "khobar", { is_discovery_root: true, auto_ingest: false });
  await call({ action: "ingest_review_tracking" }, `Bearer ${SERVICE_KEY}`);
  assertEquals(processedFolders(), ["gm-khobar-root"]);
});
