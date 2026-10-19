const fs = require("fs");
const path = require("path");
const {
  addCalendarDays,
  assessDriveIngestionHealth,
  buildCatchUpPlan,
  classifyCatchUpDate,
  folderSyncLabel,
  riyadhDateISO,
} = require("./driveIngestionHealth");

const root = path.resolve(__dirname, "../../../..");

const expiredConnection = {
  status: "reconnect_required",
  last_error: "invalid_grant: Bad Request",
  reconnect_required: true,
};

describe("Drive ingestion health", () => {
  test("a configured cron job is not a healthy pipeline", () => {
    const health = assessDriveIngestionHealth({
      now: new Date("2026-10-16T00:30:00Z"),
      connection: expiredConnection,
      folders: [{
        report_type: "cash_up",
        last_sync_at: "2026-10-16T00:00:03.803Z",
        last_sync_status: "failed",
        last_ingest_at: "2026-10-01T00:00:13.882Z",
      }],
      latestRun: {
        created_at: "2026-10-16T00:00:04.107Z",
        started_at: null,
        status: "failed",
        runtime_stage: "token_refresh_failed",
      },
      publication: { cashUpPeriodEnd: "2026-09-30" },
      cronJobConfigured: true,
    });

    expect(health.cronJobConfigured).toBe(true);
    expect(health.pipelineHealthy).toBe(false);
    expect(health.scheduler.state).toBe("EXECUTED");
    expect(health.driveConnection.state).toBe("AUTHORIZATION_EXPIRED");
    expect(health.sourceFreshness.state).toBe("STALE");
    expect(health.publicationFreshness.state).toBe("STALLED");
    expect(health.primaryIssue).toBe("CONNECTION_REQUIRED");
    expect(health.expectedPublicationDate).toBe("2026-10-15");
  });

  test("missed scheduler stays missed when the cron row exists but nothing ran", () => {
    const health = assessDriveIngestionHealth({
      now: new Date("2026-10-16T06:00:00Z"),
      connection: { status: "active", last_error: null },
      folders: [{
        report_type: "cash_up",
        last_sync_at: "2026-10-01T00:00:13Z",
        last_sync_status: "completed",
        last_ingest_at: "2026-10-01T00:00:13Z",
      }],
      latestRun: null,
      publication: { cashUpPeriodEnd: "2026-10-15" },
      cronJobConfigured: true,
    });

    expect(health.scheduler.state).toBe("MISSED");
    expect(health.pipelineHealthy).toBe(false);
    expect(health.primaryIssue).toBe("SCHEDULER_MISSED");
  });

  test("publication stall is visible when the connection is healthy", () => {
    const health = assessDriveIngestionHealth({
      now: new Date("2026-10-16T06:00:00Z"),
      connection: { status: "active", last_error: "" },
      folders: [{
        report_type: "cash_up",
        last_sync_at: "2026-10-16T00:00:10Z",
        last_sync_status: "completed",
        last_ingest_at: "2026-10-16T00:05:00Z",
      }],
      latestRun: {
        created_at: "2026-10-16T00:00:10Z",
        status: "completed",
        runtime_stage: "completed",
      },
      publication: { cashUpPeriodEnd: "2026-09-30" },
    });

    expect(health.driveConnection.state).toBe("CONNECTED");
    expect(health.sourceFreshness.state).toBe("CURRENT");
    expect(health.publicationFreshness.state).toBe("STALLED");
    expect(health.pipelineHealthy).toBe(false);
    expect(health.primaryIssue).toBe("PUBLICATION_STALLED");
  });

  test("unknown publication is not marked current", () => {
    const health = assessDriveIngestionHealth({
      now: new Date("2026-10-16T06:00:00Z"),
      connection: { status: "active" },
      folders: [{
        report_type: "cash_up",
        last_sync_at: "2026-10-16T00:00:10Z",
        last_ingest_at: "2026-10-16T00:05:00Z",
      }],
      latestRun: { created_at: "2026-10-16T00:00:10Z", status: "completed" },
      publication: null,
    });
    expect(health.publicationFreshness.state).toBe("UNKNOWN");
    expect(health.pipelineHealthy).toBe(false);
  });

  test("Riyadh date boundary uses the previous completed business date", () => {
    expect(riyadhDateISO(new Date("2026-10-15T20:30:00Z"))).toBe("2026-10-15");
    expect(riyadhDateISO(new Date("2026-10-15T21:30:00Z"))).toBe("2026-10-16");
    const beforeMidnight = assessDriveIngestionHealth({
      now: new Date("2026-10-15T20:30:00Z"),
      publication: { cashUpPeriodEnd: "2026-10-14" },
      connection: { status: "active" },
      folders: [{
        report_type: "cash_up",
        last_sync_at: "2026-10-15T00:00:00Z",
        last_ingest_at: "2026-10-15T00:10:00Z",
      }],
      latestRun: { created_at: "2026-10-15T00:00:00Z", status: "completed" },
    });
    const afterMidnight = assessDriveIngestionHealth({
      now: new Date("2026-10-15T21:30:00Z"),
      publication: { cashUpPeriodEnd: "2026-10-14" },
      connection: { status: "active" },
      folders: [{
        report_type: "cash_up",
        last_sync_at: "2026-10-15T21:00:00Z",
        last_ingest_at: "2026-10-15T21:10:00Z",
      }],
      latestRun: { created_at: "2026-10-15T21:00:00Z", status: "completed" },
    });
    expect(beforeMidnight.expectedPublicationDate).toBe("2026-10-14");
    expect(beforeMidnight.publicationFreshness.state).toBe("CURRENT");
    expect(afterMidnight.expectedPublicationDate).toBe("2026-10-15");
    expect(afterMidnight.publicationFreshness.state).toBe("STALLED");
    expect(addCalendarDays("2026-10-01", 14)).toBe("2026-10-15");
  });

  test("failed folder sync is not labeled up to date", () => {
    expect(folderSyncLabel({
      last_sync_status: "failed",
      last_sync_at: "2026-10-16T00:00:03Z",
      last_ingest_at: "2026-10-01T00:00:13Z",
    }, (value) => value)).toBe("sync failed · last published 2026-10-01T00:00:13Z");
  });
});

describe("October Cash Up catch-up classification", () => {
  const dates = buildCatchUpPlan({
    start: "2026-10-01",
    end: "2026-10-15",
    publishedDates: [],
    workbookDates: null,
  });

  test("does not invent workbook dates or sales when Drive cannot be listed", () => {
    expect(dates).toHaveLength(15);
    expect(dates.every((row) => row.status === "SOURCE_NOT_CHECKED")).toBe(true);
    expect(dates.some((row) => Object.prototype.hasOwnProperty.call(row, "sales"))).toBe(false);
    expect(JSON.stringify(dates)).not.toMatch(/net_sales|SAR|[0-9]{4,}\.[0-9]/);
  });

  test("classifies source, download, parse, canonical, and published dates without duplicates", () => {
    expect(classifyCatchUpDate({
      date: "2026-10-03",
      workbookDates: ["2026-10-03"],
    })).toBe("AVAILABLE_IN_DRIVE");
    expect(classifyCatchUpDate({
      date: "2026-10-04",
      workbookDates: ["2026-10-03"],
    })).toBe("MISSING_SOURCE");
    expect(classifyCatchUpDate({
      date: "2026-10-03",
      downloadedDates: ["2026-10-03"],
      workbookDates: ["2026-10-03"],
    })).toBe("DOWNLOADED");
    expect(classifyCatchUpDate({
      date: "2026-10-03",
      parsedDates: ["2026-10-03"],
      downloadedDates: ["2026-10-03"],
    })).toBe("PARSED");
    expect(classifyCatchUpDate({
      date: "2026-10-03",
      canonicalDates: ["2026-10-03"],
      parsedDates: ["2026-10-03"],
    })).toBe("CANONICALIZED");
    expect(classifyCatchUpDate({
      date: "2026-10-03",
      publishedDates: ["2026-10-03"],
      canonicalDates: ["2026-10-03"],
    })).toBe("PUBLISHED");

    const first = buildCatchUpPlan({
      start: "2026-10-01",
      end: "2026-10-03",
      publishedDates: ["2026-10-01"],
      workbookDates: ["2026-10-01", "2026-10-02"],
    });
    const replay = buildCatchUpPlan({
      start: "2026-10-01",
      end: "2026-10-03",
      publishedDates: ["2026-10-01"],
      workbookDates: ["2026-10-01", "2026-10-02"],
    });
    expect(replay).toEqual(first);
    expect(first.map((row) => row.status)).toEqual([
      "PUBLISHED",
      "AVAILABLE_IN_DRIVE",
      "MISSING_SOURCE",
    ]);
  });

  test("token failure records a visible run and replay replaces facts only after insert", () => {
    const scheduled = fs.readFileSync(
      path.join(root, "supabase/functions/_shared/vaultDriveScheduledIngest.ts"),
      "utf8",
    );
    const replace = fs.readFileSync(
      path.join(root, "supabase/functions/_shared/vaultStructuredFactsReplace.ts"),
      "utf8",
    );
    const cron = fs.readFileSync(
      path.join(root, "supabase/migrations/20261016120000_drive_ingest_scheduler_health.sql"),
      "utf8",
    );
    expect(scheduled).toMatch(/started_at: now/);
    expect(scheduled).toMatch(/runtime_stage: "token_refresh_failed"/);
    expect(scheduled).toMatch(/runInsertError/);
    expect(replace).toMatch(/Remove prior versions only after the new version fully inserted/);
    expect(replace).toMatch(/file_version_id", versionId/);
    expect(cron).toMatch(/ok/);
    expect(cron).toMatch(/raise exception/);
    expect(cron).not.toMatch(/raise exception[\s\S]{0,180}v_secret/);
    const driveFunction = fs.readFileSync(
      path.join(root, "supabase/functions/vault-drive-sync/index.ts"),
      "utf8",
    );
    expect(driveFunction).toMatch(/await supabase\s*\n\s*\.from\("ask_nac_data_coverage"\)/);
    expect(driveFunction).toMatch(/ingestOk \? 200 : 503/);
  });
});
