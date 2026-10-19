const fs = require("fs");
const path = require("path");

const migration = fs.readFileSync(
  path.join(__dirname, "../../../../supabase/migrations/20261016120000_drive_ingest_scheduler_health.sql"),
  "utf8",
);

describe("Drive scheduler migration", () => {
  test("submits pg_net work and does not wait for the response before commit", () => {
    expect(migration).not.toMatch(/pg_sleep/);
    const invoke = migration.split("create or replace function public.reconcile_nac_drive_scheduler_submissions")[0];
    expect(invoke).toMatch(/net\.http_post/);
    expect(invoke).not.toMatch(/_http_response/);
    expect(invoke).toMatch(/'submitted'/);
  });

  test("reconciles completion later and does not retry authentication failures", () => {
    expect(migration).toMatch(/reconcile_nac_drive_scheduler_submissions/);
    expect(migration).toMatch(/attempt < 3/);
    expect(migration).toMatch(/invalid_grant\|revoked\|reconnect\|connection_required\|invalid scheduled ingest secret/);
    expect(migration).toMatch(/v_status is distinct from 401/);
    expect(migration).toMatch(/v_status is distinct from 403/);
    expect(migration).toMatch(/no pg_net response after 15 minutes/);
    expect(migration).toMatch(/interval '10 minutes'/);
    expect(migration).toMatch(/Bearer \[redacted\]/);
    expect(migration).toMatch(/revoke all on function public.reconcile_nac_drive_scheduler_submissions\(\) from anon/);
    expect(migration).toMatch(/grant execute on function public.invoke_nac_scheduled_drive_ingest\(\) to postgres/);
    expect(migration).not.toMatch(/grant execute on function public.invoke_nac_scheduled_drive_ingest\(\) to anon/);
  });
});
