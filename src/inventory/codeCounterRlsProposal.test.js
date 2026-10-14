import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    "docs/security/proposed-migrations/20261014000000_inventory_code_counters_rls.NOT_APPLIED.sql",
  ),
  "utf8",
);

const body = sql.split("-- Rollback")[0];

test("the code-counter migration is idempotent and does not open a policy", () => {
  expect(body).toMatch(/enable row level security/i);
  expect(body).not.toMatch(/create policy/i);
  expect(body).not.toMatch(/force row level security/i);
  expect(body).toMatch(/revoke all on table public\.inventory_code_counters from anon, authenticated/i);
  expect(body).toMatch(/revoke all on function public\.allocate_inventory_human_code\(text\) from public, anon/i);
  expect(body).toMatch(/grant execute on function public\.allocate_inventory_human_code\(text\) to authenticated, service_role/i);
});

test("anonymous and non-inventory roles are refused before the counter moves", () => {
  const guard = body.indexOf("auth.uid() is null");
  const role = body.indexOf("ask_nac_vault_role()");
  const move = body.indexOf("set next_number = v_number + 1");
  expect(guard).toBeGreaterThan(0);
  expect(role).toBeGreaterThan(guard);
  expect(move).toBeGreaterThan(role);
  expect(body).toMatch(/branch_manager/);
  expect(body).toMatch(/set search_path = public/);
  expect(body).toMatch(/for update/);
});
