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

// Paginated fake admin with real range() semantics and a PostgREST-style 1000-row cap.
function pagedAdmin(tables: Record<string, any[]>, failPage = -1) {
  return {
    from: (t: string) => {
      const rows = tables[t] || [];
      const q: any = {
        order: () => q,
        range: (from: number, to: number) => {
          if (from / 1000 === failPage) return Promise.resolve({ data: null, error: { message: "page" } });
          return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null });
        },
        select: () => q,
      };
      return q;
    },
  };
}
const bigStaff = Array.from({ length: 2500 }, (_, i) => ({ email: `filler${i}@x.test`, vault_role: "staff" }));
const roleRows = [{ code: "branch_manager", cross_branch: false, can_upload: true }, { code: "staff", cross_branch: false, can_upload: false }];

Deno.test("owner authority reads beyond the PostgREST row cap (pagination)", async () => {
  const staff = [...bigStaff, { email: "late-gm@x.test", vault_role: "branch_manager", primary_branch_id: "khobar" }];
  const a = createOwnerAuthority(pagedAdmin({ ask_nac_staff: staff, ask_nac_roles: roleRows }));
  assertEquals(await a.canIngestBranch("late-gm@x.test", "khobar"), true);
});

Deno.test("owner authority fails closed if any page errors (no partial authority)", async () => {
  // the GM is on page 2 (rows 1000-1999), page 3 errors: partial reads must not grant anything
  const staff = [...bigStaff.slice(0, 1500), { email: "late-gm@x.test", vault_role: "branch_manager", primary_branch_id: "khobar" }, ...bigStaff.slice(1500)];
  const a = createOwnerAuthority(pagedAdmin({ ask_nac_staff: staff, ask_nac_roles: roleRows }, 2));
  assertEquals(await a.canIngestBranch("late-gm@x.test", "khobar"), false);
});

Deno.test("owner authority: X1 profile (menu Khobar GM, vault staff with Riyadh) is Khobar-only", async () => {
  const a = createOwnerAuthority(admin());
  const x1 = createOwnerAuthority({
    from: (t: string) => ({ select: () => Promise.resolve({ data: ({
      ask_nac_roles: tables.ask_nac_roles,
      ask_nac_staff: [{ email: "x1@x.test", vault_role: "staff", primary_branch_id: "riyadh" }],
      ask_nac_user_branch_access: [{ email: "x1@x.test", branch_id: "riyadh" }],
      menu_staff_scope: [{ email: "X1@X.test", branch_id: "khobar", role: "branch_gm" }],
    } as Record<string, any[]>)[t] || [], error: null }) }),
  });
  assertEquals([await x1.canIngestBranch("x1@x.test", "khobar"), await x1.canIngestBranch("x1@x.test", "riyadh")], [true, false]);
  assertEquals(await a.canIngestBranch("mgm@x.test", "khobar"), false);
});
