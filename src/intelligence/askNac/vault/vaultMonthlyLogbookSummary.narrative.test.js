import { buildMonthlyLogbookExecutiveSummary } from "./vaultMonthlyLogbookSummary";

const fact = (day, metricKey, text) => ({
  fileId: `file-${day}`, fileTitle: `${day} Oct logbook`, periodStart: `2026-10-${day}`,
  metricKey, dimensions: { text_value: text },
});

describe("monthly logbook narrative completeness", () => {
  test("reads breakfast and lunch notes from historical recovery", () => {
    const result = buildMonthlyLogbookExecutiveSummary({
      facts: [
        fact("01", "breakfast_notes", "Breakfast walk-in guests complained about cold eggs."),
        fact("01", "lunch_notes", "Lunch service was slow due to staffing."),
        fact("01", "dinner_notes", "Dinner completed without reported incidents."),
      ],
      branchLabel: "Khobar", periodLabel: "October 2026",
    });
    expect(result.directAnswer).toMatch(/Breakfast walk-in guests complained about cold eggs/i);
    expect(result.directAnswer).toMatch(/Lunch service was slow due to staffing/i);
    expect(result.logbookDays).toBe(1);
  });

  test("one-day maintenance incident is not incorrectly labeled recurring", () => {
    const result = buildMonthlyLogbookExecutiveSummary({
      facts: [fact("01", "breakfast_notes", "Pest control repaired the fly trap.")],
      branchLabel: "Khobar", periodLabel: "October 2026", mode: "recurring",
    });
    expect(result.directAnswer).toMatch(/No recurring themes reached the 2\+ day threshold/i);
  });
});
