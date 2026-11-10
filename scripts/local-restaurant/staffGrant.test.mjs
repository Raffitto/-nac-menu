import assert from "node:assert/strict";
import test from "node:test";
import { selectStaffGrant } from "./staffGrant.mjs";

test("a client role is ignored and the database grant is used", () => {
  const selected = selectStaffGrant(
    [{ role: "waiter", branch_id: "khobar" }],
    "khobar",
  );
  assert.equal(selected.role, "waiter");
  assert.equal(selected.branchId, "khobar");
});

test("a branch without a grant is rejected", () => {
  const selected = selectStaffGrant(
    [{ role: "waiter", branch_id: "khobar" }],
    "riyadh",
  );
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, "branch_forbidden");
});

test("several grants require an explicit branch the person actually has", () => {
  const missing = selectStaffGrant([
    { role: "host", branch_id: "khobar" },
    { role: "host", branch_id: "riyadh" },
  ], "");
  assert.equal(missing.reason, "branch_required");
  const chosen = selectStaffGrant([
    { role: "host", branch_id: "khobar" },
    { role: "manager", branch_id: "riyadh" },
  ], "riyadh");
  assert.equal(chosen.role, "manager");
  assert.equal(chosen.branchId, "riyadh");
});

test("a missing grant fails closed", () => {
  assert.equal(selectStaffGrant([], "khobar").reason, "branch_forbidden");
});
