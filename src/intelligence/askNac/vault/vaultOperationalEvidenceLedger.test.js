import { buildOperationalEvidenceLedger, compareOperationalEvidenceWindows } from "./vaultMonthlyLogbookSummary";

const fact = (date, section, text) => ({
  periodStart: date, metricKey: section, dimensions: { text_value: text },
  fileId: date, fileTitle: `Logbook ${date}`,
});

describe("operational evidence ledger and date-window comparison", () => {
  const facts = [
    fact("2026-10-01", "breakfast_notes", "Guest complained about cold eggs."),
    fact("2026-10-01", "breakfast_notes", "Guest complained about cold eggs."),
    fact("2026-10-02", "lunch_notes", "Pest control repaired the fly trap."),
    fact("2026-10-08", "dinner_notes", "Guest complained about late food."),
    fact("2026-10-09", "training_notes", "Staff training completed."),
  ];

  test("deduplicates repeated source records but preserves sections and dates", () => {
    const ledger = buildOperationalEvidenceLedger(facts);
    expect(ledger).toHaveLength(4);
    expect(ledger[0]).toMatchObject({ date: "2026-10-01", section: "breakfast_notes", fileId: "2026-10-01" });
    expect(ledger[0].themes).toContain("complaint");
  });

  test("compares two weeks using operational evidence, not sales", () => {
    const ledger = buildOperationalEvidenceLedger(facts);
    const result = compareOperationalEvidenceWindows(ledger,
      { startDate: "2026-10-01", endDate: "2026-10-07", label: "Oct 1–7" },
      { startDate: "2026-10-08", endDate: "2026-10-14", label: "Oct 8–14" });
    expect(result.first.daysCovered).toBe(2);
    expect(result.second.daysCovered).toBe(2);
    expect(result.changes.find((c) => c.id === "maintenance")).toMatchObject({ firstDays: 1, secondDays: 0, deltaDays: -1 });
    expect(result.changes.find((c) => c.id === "complaint")).toMatchObject({ firstDays: 1, secondDays: 1, deltaDays: 0 });
  });
});
