import { mapRpcLogbookMonthBundle } from "./vaultLogbookMonthRpc";

describe("vaultLogbookMonthRpc", () => {
  test("maps RPC bundle into summary-ready facts and coverage", () => {
    const bundle = mapRpcLogbookMonthBundle({
      facts: [{
        fileId: "f1",
        periodStart: "2026-05-11",
        periodEnd: "2026-05-11",
        metricKey: "complaints",
        metricValue: null,
        dimensions: { text_value: "Fly complaint" },
        confidence: 0.9,
      }],
      coverage: [{
        periodStart: "2026-05-11",
        periodEnd: "2026-05-11",
        readinessStatus: "ready",
        sourceFileId: "f1",
        fileTitle: "11 May NAC Khobar Logbook.txt",
        factCount: 12,
      }],
      coverageSummary: {
        distinctDays: 1,
        readyDays: 1,
        partialDays: 0,
        fileCount: 1,
      },
    });

    expect(bundle.facts).toHaveLength(1);
    expect(bundle.facts[0].metricKey).toBe("complaints");
    expect(bundle.coverage[0].fileTitle).toMatch(/11 May/i);
    expect(bundle.coverageSummary.readyDays).toBe(1);
  });
});
