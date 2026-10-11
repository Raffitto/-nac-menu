import { assertEquals } from "../assert.ts";
import { createOwnerAuthority } from "../../../supabase/functions/_shared/vaultDriveOwnerAuthorization.ts";

const tables: Record<string, any[]> = {
  ask_nac_roles: [
    { code: "ceo", cross_branch: true, can_upload: true },
    { code: "branch_manager", cross_branch: false, can_upload: true },
    { code: "marketing", cross_branch: false, can_upload: true },
    { code: "staff", cross_branch: false, can_upload: false },
  ],
  ask_nac_staff: [
    { email: "CEO@x.test", vault_role: "ceo" },
    { email: "gm@x.test", vault_role: "branch_manager", primary_branch_id: "khobar" },
    { email: "mkt@x.test", vault_role: "marketing" },
    { email: "acc@x.test", vault_role: "staff" },
  ],
  ask_nac_user_branch_access: [{ email: "acc@x.test", branch_id: "riyadh" }, { email: "gm@x.test", branch_id: "Jeddah" }],
  menu_staff_scope: [
    { email: "dev@x.test", branch_id: null, role: "developer" },
    { email: "mgm@x.test", branch_id: "riyadh", role: "branch_gm" },
    { email: "res@x.test", branch_id: "riyadh", role: "restricted" },
  ],
};
const admin = (fail = false) => ({
  from: (t: string) => ({ select: () => Promise.resolve(fail ? { data: null, error: { message: "x" } } : { data: tables[t] || [], error: null }) }),
});

Deno.test("owner authority matrix (vault OR NAC OS RBAC; access alone never grants)", async () => {
  const a = createOwnerAuthority(admin());
  const cases: Array<[string, unknown, boolean]> = [
    ["ceo@x.test", "riyadh", true], ["ceo@x.test", null, true],
    ["gm@x.test", "khobar", true], ["gm@x.test", "jeddah", true], ["gm@x.test", "riyadh", false], ["gm@x.test", null, false],
    ["mkt@x.test", "brand", true], ["mkt@x.test", "khobar", false],
    ["acc@x.test", "riyadh", false],                        // branch access, staff role (no can_upload)
    ["dev@x.test", "jeddah", true], ["dev@x.test", null, true],
    ["mgm@x.test", "riyadh", true], ["mgm@x.test", "khobar", false], ["mgm@x.test", null, false],
    ["res@x.test", "riyadh", false],                        // restricted menu role
    ["nobody@x.test", "khobar", false], ["", "khobar", false], ["gm@x.test", "atlantis", false],
  ];
  for (const [email, branch, expected] of cases) {
    assertEquals(await a.canIngestBranch(email, branch), expected, `${email} ${branch}`);
  }
});

Deno.test("owner authority fails closed when tables cannot be read", async () => {
  const a = createOwnerAuthority(admin(true));
  assertEquals(await a.canIngestBranch("ceo@x.test", "khobar"), false);
  assertEquals(await a.canIngestAny("dev@x.test"), false);
});
