/**
 * F14 regression: internal (non-user) authorization of ingest_review_tracking / scheduled_ingest.
 * Runs the real handler offline. See tests/edge-functions/README.md.
 */
import { assertEquals } from "../assert.ts";
import { call, hs256Jwt, resetState, SCHED_SECRET, SERVICE_KEY, state, unsignedJwt } from "../harness.ts";

const SR_CLAIMS = { role: "service_role", iss: "supabase", exp: 4102444800 };

async function reviewIngest(auth?: string) {
  resetState();
  const r = await call({ action: "ingest_review_tracking" }, auth);
  return { ...r, ingested: state.reviewTrackingIngests.length };
}

Deno.test("F14-1 forged UNSIGNED JWT with role=service_role is rejected", async () => {
  const r = await reviewIngest(`Bearer ${unsignedJwt(SR_CLAIMS)}`);
  assertEquals([r.status, r.ingested], [401, 0]);
});

Deno.test("F14-2 JWT role=service_role signed with a WRONG key is rejected", async () => {
  const r = await reviewIngest(`Bearer ${await hs256Jwt(SR_CLAIMS, "attacker-chosen-key")}`);
  assertEquals([r.status, r.ingested], [401, 0]);
});

Deno.test("F14-3 exact configured service-role key is accepted", async () => {
  const r = await reviewIngest(`Bearer ${SERVICE_KEY}`);
  assertEquals([r.status, r.ingested, r.body?.ok], [200, 1, true]);
});

Deno.test("F14-4 scheduled secret is accepted on ingest_review_tracking", async () => {
  const r = await reviewIngest(`Bearer ${SCHED_SECRET}`);
  assertEquals([r.status, r.ingested], [200, 1]);
});

Deno.test("F14-5 nightly scheduled_ingest (pg_cron) accepts the secret and still runs review tracking", async () => {
  resetState();
  const r = await call({ action: "scheduled_ingest", maxFolders: 2, maxFilesPerRun: 10 }, `Bearer ${SCHED_SECRET}`);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(state.reviewTrackingIngests, [{ triggerType: "scheduled" }]);
  assertEquals(state.rpcCalls.length, 0, "service path must not depend on user RPCs");
});

Deno.test("F14-6 scheduled_ingest rejects forged JWT, service key and near-miss secrets", async () => {
  for (const auth of [
    `Bearer ${unsignedJwt(SR_CLAIMS)}`,
    `Bearer ${SERVICE_KEY}`,
    `Bearer ${SCHED_SECRET}x`,
    `Bearer ${SCHED_SECRET.slice(0, -1)}`,
    `Bearer ${"x".repeat(SCHED_SECRET.length)}`,
  ]) {
    resetState();
    const r = await call({ action: "scheduled_ingest" }, auth);
    assertEquals([r.status, state.reviewTrackingIngests.length], [401, 0], auth.slice(0, 16));
  }
});

Deno.test("F14-7 missing Authorization is rejected", async () => {
  const r = await reviewIngest();
  assertEquals([r.status, r.ingested], [401, 0]);
});

Deno.test("F14-8 empty / malformed / near-miss bearer values are rejected", async () => {
  for (const a of ["Bearer ", "Bearer", "", "Basic abc", "Bearer a.b.c", `Bearer ${SERVICE_KEY}x`, `Bearer ${SERVICE_KEY.slice(0, -1)}`]) {
    const r = await reviewIngest(a);
    assertEquals([r.status, r.ingested], [401, 0], JSON.stringify(a.slice(0, 12)));
  }
});

Deno.test("F14-9 user actions require a real session (forged 'authenticated' JWT is not enough)", async () => {
  resetState();
  const r = await call({ action: "status" }, `Bearer ${unsignedJwt({ role: "authenticated", email: "x@example.com" })}`);
  assertEquals(r.status, 401);
});
