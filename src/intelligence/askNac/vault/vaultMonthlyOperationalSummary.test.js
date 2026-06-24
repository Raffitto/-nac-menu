import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import {
  isVaultMonthlyOperationalSummaryQuery,
  scoreVaultMonthlyOperationalSummaryIntent,
  preferredMonthlyOperationalIntent,
  extractOperationalMonthPeriod,
} from "./vaultMonthlyOperationalSummaryRouting";
import { buildMonthlyLogbookExecutiveSummary, groupFactsByDay } from "./vaultMonthlyLogbookSummary";

describe("vaultMonthlyOperationalSummaryRouting", () => {
  test("routes Summarize May operations to operational review", () => {
    const route = routeAskNacIntent("Summarize May operations", { branch: "khobar" });
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.UNKNOWN);
    expect(route.vaultPeriod?.isMonth).toBe(true);
    expect(route.vaultPeriod?.label).toMatch(/May/i);
  });

  test("routes logbook highlights to document summary", () => {
    const route = routeAskNacIntent("Give me May logbook highlights", { branch: "khobar" });
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY);
    expect(isVaultMonthlyOperationalSummaryQuery("Give me May logbook highlights")).toBe(true);
    expect(preferredMonthlyOperationalIntent("Give me May logbook highlights")).toBe("vault_document_summary");
  });

  test("scores monthly operational intent above unknown", () => {
    expect(scoreVaultMonthlyOperationalSummaryIntent("What happened operationally in May?")).toBeGreaterThanOrEqual(36);
    expect(scoreVaultMonthlyOperationalSummaryIntent("Compare April vs May operational themes")).toBeGreaterThanOrEqual(36);
  });

  test("extracts May period from operational phrasing", () => {
    const period = extractOperationalMonthPeriod("Summarize March operations");
    expect(period?.startDate).toBe("2026-03-01");
    expect(period?.endDate).toBe("2026-03-31");
  });
});

describe("buildMonthlyLogbookExecutiveSummary", () => {
  test("builds executive sections from structured facts", () => {
    const facts = [
      {
        fileId: "f1",
        fileTitle: "11 May NAC Khobar Logbook.txt",
        periodStart: "2026-05-11",
        metricKey: "operational_highlights",
        dimensions: { text_value: "Mall empty, mostly coffee and dessert traffic, low covers." },
      },
      {
        fileId: "f2",
        fileTitle: "9 May NAC Khobar Logbook.txt",
        periodStart: "2026-05-09",
        metricKey: "complaints",
        dimensions: { text_value: "Jisr punch-in/out issue and fly/live insect complaints at table." },
      },
      {
        fileId: "f2",
        fileTitle: "9 May NAC Khobar Logbook.txt",
        periodStart: "2026-05-09",
        metricKey: "covers",
        metricValue: 81,
      },
      {
        fileId: "f1",
        fileTitle: "11 May NAC Khobar Logbook.txt",
        periodStart: "2026-05-11",
        metricKey: "google_review_5",
        metricValue: 6,
      },
    ];

    const summary = buildMonthlyLogbookExecutiveSummary({
      facts,
      coverage: [
        { readinessStatus: "ready", periodStart: "2026-05-09" },
        { readinessStatus: "ready", periodStart: "2026-05-11" },
      ],
      branchLabel: "Khobar",
      periodLabel: "May 2026",
      mode: "summary",
    });

    expect(summary.logbookDays).toBe(2);
    expect(summary.directAnswer).toMatch(/Executive Summary/i);
    expect(summary.directAnswer).toMatch(/mall empty|coffee|dessert/i);
    expect(summary.directAnswer).toMatch(/jisr|insect|fly/i);
    expect(summary.confidence).toBe("low");
    expect(groupFactsByDay(facts)).toHaveLength(2);
  });
});
