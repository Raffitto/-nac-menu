import { assertEquals } from "../assert.ts";
import { createDriveBranchAuthorizer, normalizeDriveBranchId } from "../../../supabase/functions/_shared/vaultDriveAuthorization.ts";

Deno.test("normalizeDriveBranchId mirrors nac_normalize_branch_id", () => {
  assertEquals(["khobar", " Riyadh ", "Al Khobar", "jiddah", "الخبر", "brand", "", null, "network"].map(normalizeDriveBranchId),
    ["khobar", "riyadh", "khobar", "jeddah", "khobar", null, null, null, null]);
});

Deno.test("authorizer fails closed when RPCs error or throw", async () => {
  const erroring = createDriveBranchAuthorizer({ rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) });
  assertEquals((await erroring.authorizeBranch("khobar")).ok, false);
  const throwing = createDriveBranchAuthorizer({ rpc: () => { throw new Error("network"); } });
  assertEquals((await throwing.authorizeBranch("khobar")).ok, false);
  const truthyNonBool = createDriveBranchAuthorizer({ rpc: () => Promise.resolve({ data: "true", error: null }) });
  assertEquals((await truthyNonBool.authorizeBranch("khobar")).ok, false);
});

Deno.test("authorizer memoizes RPCs per request", async () => {
  let calls = 0;
  const a = createDriveBranchAuthorizer({ rpc: () => { calls++; return Promise.resolve({ data: true, error: null }); } });
  await a.authorizeBranch("khobar");
  const before = calls;
  await a.authorizeBranch("khobar");
  assertEquals(calls, before);
});
