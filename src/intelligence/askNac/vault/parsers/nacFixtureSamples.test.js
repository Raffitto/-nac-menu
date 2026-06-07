import { parseDailyLogbookText } from "./parseDailyLogbook";
import { parseCcmReconciliationReport } from "./parseCcmReconciliation";
import { createIntermediate } from "./vaultIntermediate";

const NAC_LOGBOOK_TEXT = `
Branch: Khobar
Day: 05/06/2026
Lunch MOD: Sara
Dinner MOD: Fady
Chef on duty: Marco
Bar MOD: Ali
Reception total: reservations 176, covers 521, walk-ins 344, no-shows 59, cancellations 16
Google reviews: 5-star 9, 3-star 1
Dinner notes: Strong service recovery after 8pm rush; two VIP walk-ins handled well.
Training notes: New host trained on cover pacing.
`;

describe("NAC fixture samples", () => {
  test("logbook reception totals from inline prose", () => {
    const result = parseDailyLogbookText(NAC_LOGBOOK_TEXT, {
      fileId: "log-1",
      branchId: "khobar",
      department: "operations",
      sensitivityLevel: "internal",
      createdBy: "test@nac.com",
    });

    expect(result.facts.find((f) => f.metric_key === "reservations").metric_value).toBe(176);
    expect(result.facts.find((f) => f.metric_key === "covers").metric_value).toBe(521);
    expect(result.facts.find((f) => f.metric_key === "walkins").metric_value).toBe(344);
    expect(result.facts.find((f) => f.metric_key === "no_shows").metric_value).toBe(59);
    expect(result.facts.find((f) => f.metric_key === "cancellations").metric_value).toBe(16);
  });

  test("logbook Google review star counts (5-star 9, 3-star 1)", () => {
    const result = parseDailyLogbookText(NAC_LOGBOOK_TEXT, {
      fileId: "log-1",
      branchId: "khobar",
      createdBy: "test@nac.com",
    });
    expect(result.facts.find((f) => f.metric_key === "google_review_5").metric_value).toBe(9);
    expect(result.facts.find((f) => f.metric_key === "google_review_3").metric_value).toBe(1);
  });

  test("dinner notes extracted as text fact", () => {
    const result = parseDailyLogbookText(NAC_LOGBOOK_TEXT, {
      fileId: "log-1",
      branchId: "khobar",
      createdBy: "test@nac.com",
    });
    const dinner = result.facts.find((f) => f.metric_key === "dinner_notes");
    expect(dinner.dimensions.text_value).toMatch(/VIP walk-ins/);
  });

  test("CCM reconciliation basic rows", () => {
    const matrix = [
      ["CCM Expected", 50000],
      ["CCM Actual", 49850],
      ["Difference", -150],
      ["Reconciliation Status", "Balanced"],
      ["Payment Method Total", 49850],
    ];
    const intermediate = createIntermediate({
      fileType: "csv",
      extension: "csv",
      matrix,
      text: matrix.map((r) => r.join(": ")).join("\n"),
    });
    const result = parseCcmReconciliationReport(intermediate, {
      fileId: "ccm-1",
      branchId: "khobar",
      department: "admin",
      sensitivityLevel: "finance",
      createdBy: "test@nac.com",
    });

    expect(result.ok).toBe(true);
    expect(result.facts.find((f) => f.metric_key === "ccm_expected").metric_value).toBe(50000);
    expect(result.facts.find((f) => f.metric_key === "ccm_difference").metric_value).toBe(-150);
    expect(
      result.facts.find((f) => f.metric_key === "reconciliation_status").dimensions.text_value,
    ).toMatch(/balanced/i);
  });
});
