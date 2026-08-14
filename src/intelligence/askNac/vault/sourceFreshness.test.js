const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const ingestPath = path.join(root, "supabase/functions/_shared/driveFileChangeDetection.ts");
const freshnessPath = path.join(root, "supabase/functions/_shared/sourceFreshness.ts");

function run(body) {
  const script = `
    import(${JSON.stringify(ingestPath)}).then(async (ingest) => {
      const freshness = await import(${JSON.stringify(freshnessPath)});
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim().split("\n").filter(Boolean).pop());
}

const existing = {
  id: "file-1",
  content_hash: "abc",
  source_external_checksum: "md5-old",
  source_external_version: "6490",
  external_source_modified_at: "2026-08-13T22:47:38.373Z",
  searchable: true,
  chunk_count: 12,
};

describe("Drive same-ID change detection + source freshness", () => {
  test("unchanged checksum with current facts is skipped", () => {
    const out = run(`
      return ingest.isUnchangedDriveFile(
        ${JSON.stringify({ ...existing, source_external_checksum: "md5-new" })},
        { id: "drv", name: "Cash up 2026.xlsx", md5Checksum: "md5-new", version: "6490", modifiedTime: "2026-08-13T22:47:38.373Z" },
        { last_ingested_at: "2026-08-14T00:10:00Z", period_end: "2026-08-13", fact_count: 5000 },
      );
    `);
    expect(out).toBe(true);
  });

  test("absent or timestamp-less coverage retries even when checksum matches", () => {
    const out = run(`
      const file = ${JSON.stringify({ ...existing, source_external_checksum: "md5-new" })};
      const drive = { id: "drv", name: "Cash up 2026.xlsx", md5Checksum: "md5-new", version: "6490", modifiedTime: "2026-08-13T22:47:38.373Z" };
      return {
        absent: ingest.isUnchangedDriveFile(file, drive, null),
        noIngestedAt: ingest.isUnchangedDriveFile(file, drive, { last_ingested_at: null, period_end: "2026-08-08", fact_count: 4885 }),
        behind: ingest.canonicalFactsBehindSource(file, null, drive),
      };
    `);
    expect(out.absent).toBe(false);
    expect(out.noIngestedAt).toBe(false);
    expect(out.behind).toBe(true);
  });

  test("same Drive ID with newer source than last ingest is not skipped", () => {
    const out = run(`
      return {
        behind: ingest.canonicalFactsBehindSource(
          ${JSON.stringify(existing)},
          { last_ingested_at: "2026-08-09T08:55:03Z", period_end: "2026-08-08", fact_count: 4885 },
          { modifiedTime: "2026-08-13T22:47:38.373Z" },
        ),
        unchanged: ingest.isUnchangedDriveFile(
          ${JSON.stringify(existing)},
          { id: "drv", name: "Cash up 2026.xlsx", md5Checksum: "md5-old", version: "6490", modifiedTime: "2026-08-13T22:47:38.373Z" },
          { last_ingested_at: "2026-08-09T08:55:03Z", period_end: "2026-08-08", fact_count: 4885 },
        ),
      };
    `);
    expect(out.behind).toBe(true);
    expect(out.unchanged).toBe(false);
  });

  test("pending while still inside close plus grace", () => {
    const out = run(`
      return freshness.assessSourceFreshness({
        dataset: "cash_up",
        branchId: "khobar",
        latestCanonicalBusinessDate: "2026-08-11",
        now: new Date("2026-08-14T00:30:00+03:00"),
      });
    `);
    expect(out.expectedLatestCompletedBusinessDate).toBe("2026-08-12");
    expect(out.lagDays).toBe(1);
    expect(out.status).toBe("pending");
  });

  test("canonical through expected completed day is current", () => {
    const out = run(`
      return freshness.assessSourceFreshness({
        dataset: "cash_up",
        branchId: "khobar",
        latestCanonicalBusinessDate: "2026-08-13",
        latestSourceModifiedAt: "2026-08-13T22:47:38.373Z",
        latestSuccessfulIngestionAt: "2026-08-14T20:00:00Z",
        now: new Date("2026-08-14T16:16:00.000Z"),
      });
    `);
    expect(out.expectedLatestCompletedBusinessDate).toBe("2026-08-13");
    expect(out.status).toBe("current");
  });

  test("today before grace is not a false stale alert", () => {
    const out = run(`
      return freshness.assessSourceFreshness({
        dataset: "cash_up",
        branchId: "khobar",
        latestCanonicalBusinessDate: "2026-08-12",
        now: new Date("2026-08-14T00:30:00+03:00"),
      });
    `);
    expect(out.expectedLatestCompletedBusinessDate).toBe("2026-08-12");
    expect(out.status).toBe("current");
  });

  test("closed missing day past grace is stale; ingest lag is ingestion_stale", () => {
    const out = run(`
      return freshness.assessSourceFreshness({
        dataset: "cash_up",
        branchId: "khobar",
        latestCanonicalBusinessDate: "2026-08-08",
        latestSourceModifiedAt: "2026-08-13T22:47:38.373Z",
        latestSuccessfulIngestionAt: "2026-08-09T08:55:03Z",
        now: new Date("2026-08-14T16:16:00.000Z"),
      });
    `);
    expect(out.expectedLatestCompletedBusinessDate).toBe("2026-08-13");
    expect(out.lagDays).toBe(5);
    expect(out.status).toBe("ingestion_stale");
  });

  test("source not updated through expected day is upstream_stale", () => {
    const out = run(`
      return freshness.assessSourceFreshness({
        dataset: "cash_up",
        branchId: "khobar",
        latestCanonicalBusinessDate: "2026-08-08",
        latestSourceModifiedAt: "2026-08-09T08:00:00Z",
        latestSuccessfulIngestionAt: "2026-08-09T08:55:03Z",
        now: new Date("2026-08-14T16:16:00.000Z"),
      });
    `);
    expect(out.status).toBe("upstream_stale");
  });
});
