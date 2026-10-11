import { assertEquals } from "../assert.ts";
import { createDriveBranchAuthorizer, normalizeDriveBranchId } from "../../../supabase/functions/_shared/vaultDriveAuthorization.ts";
import type { OwnerAuthority } from "../../../supabase/functions/_shared/vaultDriveOwnerAuthorization.ts";

Deno.test("normalizeDriveBranchId mirrors nac_normalize_branch_id", () => {
  assertEquals(["khobar", " Riyadh ", "Al Khobar", "jiddah", "الخبر", "brand", "", null, "network"].map(normalizeDriveBranchId),
    ["khobar", "riyadh", "khobar", "jeddah", "khobar", null, null, null, null]);
});

const owner = (impl: Partial<OwnerAuthority>): OwnerAuthority => ({
  canIngestBranch: impl.canIngestBranch ?? (() => Promise.resolve(false)),
  canIngestAny: impl.canIngestAny ?? (() => Promise.resolve(false)),
});

Deno.test("user authorizer delegates to the owner rule with the session email (lower-cased)", async () => {
  const seen: Array<[unknown, unknown]> = [];
  const a = createDriveBranchAuthorizer(owner({
    canIngestBranch: (e, b) => { seen.push([e, b]); return Promise.resolve(b === "khobar"); },
    canIngestAny: () => Promise.resolve(true),
  }), "GM@Test.Local");
  assertEquals((await a.authorizeBranch("Al Khobar")).ok, true);
  assertEquals(await a.authorizeBranch("riyadh"), { ok: false, status: 403, reason: "You are not authorized for this branch." });
  assertEquals((await a.authorizeBranch("atlantis")).ok, false);
  assertEquals(seen, [["gm@test.local", "khobar"], ["gm@test.local", "riyadh"]]);
});

Deno.test("user authorizer fails closed when the owner rule throws / rejects", async () => {
  const a = createDriveBranchAuthorizer(owner({
    canIngestBranch: () => Promise.reject(new Error("boom")),
    canIngestAny: () => { throw new Error("boom"); },
  }), "ceo@test.local");
  assertEquals((await a.authorizeBranch("khobar")).ok, false);
  assertEquals(await a.canIngest(), false);
});

Deno.test("user authorizer memoizes per request", async () => {
  let calls = 0;
  const a = createDriveBranchAuthorizer(owner({ canIngestBranch: () => { calls++; return Promise.resolve(true); } }), "x@t");
  await a.authorizeBranch("khobar");
  await a.authorizeBranch("khobar");
  assertEquals(calls, 1);
});
