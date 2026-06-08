import { resolveDuplicateAction } from "./vaultDuplicateDetection";
import { computeBranchCoverageSummary } from "./vaultCoverageDashboard";
import { walkFileList, isSupportedFile } from "./vaultBulkIngestion";
import { buildTimelineEventsFromFacts } from "./vaultOperationalTimeline";
import { sanitizeDriveApiResponse, maskToken } from "../../../lib/vaultDriveSecrets";

describe("vaultDuplicateDetection", () => {
  test("skips identical content hash", () => {
    const result = resolveDuplicateAction({
      existingFile: { id: "a", content_hash: "abc" },
      contentHash: "abc",
    });
    expect(result.action).toBe("skip_duplicate");
  });

  test("creates new version when hash differs", () => {
    const result = resolveDuplicateAction({
      existingFile: { id: "a", content_hash: "old", external_source_modified_at: "2025-01-01T00:00:00Z" },
      contentHash: "new",
      externalModifiedAt: "2025-02-01T00:00:00Z",
    });
    expect(result.action).toBe("new_version");
  });
});

describe("vaultCoverageDashboard", () => {
  test("computes branch scores from coverage rows", () => {
    const summary = computeBranchCoverageSummary([
      {
        branch_id: "khobar",
        report_type: "daily_logbook",
        readiness_status: "ready",
        fact_count: 12,
        last_ingested_at: "2025-05-01",
      },
      {
        branch_id: "khobar",
        report_type: "cash_up",
        readiness_status: "partial",
        fact_count: 4,
        last_ingested_at: "2025-05-01",
      },
    ]);

    expect(summary.khobar.overallScore).toBeGreaterThan(0);
    expect(summary.khobar.categories.some((c) => c.key === "daily_logbook")).toBe(true);
  });
});

describe("vaultBulkIngestion helpers", () => {
  test("filters unsupported extensions", () => {
    const files = [
      { name: "logbook.pdf", webkitRelativePath: "ops/logbook.pdf" },
      { name: "notes.tmp", webkitRelativePath: "ops/notes.tmp" },
    ];
    expect(walkFileList(files)).toHaveLength(1);
    expect(isSupportedFile({ name: "report.xlsx" })).toBe(true);
  });
});

describe("vaultDriveSecrets", () => {
  test("strips OAuth tokens from API payloads", () => {
    const cleaned = sanitizeDriveApiResponse({
      ok: true,
      access_token: "ya29.secret",
      refresh_token: "1//secret",
      connection: { google_account_email: "user@gmail.com", refresh_token: "1//nested" },
      manifest: [{ id: "file-1", name: "report.pdf" }],
    });
    expect(cleaned.access_token).toBeUndefined();
    expect(cleaned.refresh_token).toBeUndefined();
    expect(cleaned.connection.refresh_token).toBeUndefined();
    expect(cleaned.connection.google_account_email).toBe("user@gmail.com");
    expect(cleaned.manifest).toHaveLength(1);
  });

  test("maskToken hides middle of secret", () => {
    expect(maskToken("ya29.abcdefghijklmnop")).toBe("ya29****mnop");
  });
});

describe("vaultOperationalTimeline", () => {
  test("maps complaint facts to timeline events", () => {
    const events = buildTimelineEventsFromFacts(
      [
        {
          metric_key: "complaints",
          period_start: "2025-05-10",
          branch_id: "khobar",
          dimensions: { text_value: "Cold food complaint" },
        },
      ],
      { id: "file-1", primary_branch_id: "khobar" },
    );
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("complaint");
  });
});
