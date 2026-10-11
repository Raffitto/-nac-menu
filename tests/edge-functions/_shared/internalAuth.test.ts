import { assertEquals } from "../assert.ts";
import { authorizeInternalCaller, extractBearer, timingSafeEqualString } from "../../../supabase/functions/_shared/internalAuth.ts";

const SR = "test-service-role-key-0123456789";
const SCHED = "test-scheduled-secret-abcdef";
const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const forged = `${b64u({ alg: "none" })}.${b64u({ role: "service_role" })}.`;

Deno.test("timingSafeEqualString", async () => {
  assertEquals(await timingSafeEqualString("abc", "abc"), true);
  assertEquals(await timingSafeEqualString("abc", "abd"), false);
  assertEquals(await timingSafeEqualString("abc", "abcd"), false);
  assertEquals(await timingSafeEqualString("", "x"), false);
});
Deno.test("extractBearer", () => {
  assertEquals(extractBearer(null), null);
  assertEquals(extractBearer("Bearer "), null);
  assertEquals(extractBearer("bearer  tok "), "tok");
  assertEquals(extractBearer("Basic tok"), null);
});
Deno.test("forged unsigned service_role JWT is rejected", async () => {
  assertEquals((await authorizeInternalCaller(`Bearer ${forged}`, { serviceRoleKey: SR, scheduledSecret: SCHED })).ok, false);
});
Deno.test("exact service-role key accepted", async () => {
  assertEquals(await authorizeInternalCaller(`Bearer ${SR}`, { serviceRoleKey: SR, scheduledSecret: SCHED }), { ok: true, via: "service_role_key" });
});
Deno.test("scheduled secret accepted", async () => {
  assertEquals(await authorizeInternalCaller(`Bearer ${SCHED}`, { serviceRoleKey: SR, scheduledSecret: SCHED }), { ok: true, via: "scheduled_secret" });
});
Deno.test("scheduled-only mode rejects service-role key", async () => {
  assertEquals((await authorizeInternalCaller(`Bearer ${SR}`, { serviceRoleKey: SR, scheduledSecret: SCHED }, { scheduledSecret: true })).ok, false);
});
Deno.test("missing / unconfigured", async () => {
  assertEquals(await authorizeInternalCaller(null, { serviceRoleKey: SR }), { ok: false, reason: "missing_token" });
  assertEquals(await authorizeInternalCaller("Bearer x", {}), { ok: false, reason: "not_configured" });
  assertEquals((await authorizeInternalCaller("Bearer  ", { serviceRoleKey: "", scheduledSecret: "" })).ok, false);
});
Deno.test("validateScheduledIngestSecret is digest-based (source check: no === / length early return)", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/vaultDriveScheduledIngest.ts", import.meta.url));
  const fn = src.slice(src.indexOf("export async function validateScheduledIngestSecret"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assertEquals(/timingSafeEqualString\(/.test(body), true);
  assertEquals(/===\s*expected|\.length\s*!==/.test(body), false);
});
