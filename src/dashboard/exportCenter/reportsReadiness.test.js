import { coveringBatchIds } from "../../lib/foodicsApi";
import { assessExportCoverage } from "./coverage";

describe("Reports Foodics integrity query scope", () => {
  test("counts only batches that cover the selected range", () => {
    const batches = [
      { id: "aug", period_start: "2026-08-01", period_end: "2026-08-31" },
      { id: "empty-aug", period_start: "2026-08-01", period_end: "2026-08-31" },
      { id: "jul", period_start: "2026-07-01", period_end: "2026-07-31" },
    ];
    expect(coveringBatchIds(batches, "2026-09-01", "2026-09-05")).toEqual([]);
    expect(coveringBatchIds(batches, "2026-08-01", "2026-08-31")).toEqual(["aug", "empty-aug"]);
  });

  test("September with no covering Foodics batches is Missing, not a hang state", () => {
    const coverage = assessExportCoverage({
      from: "2026-09-01",
      to: "2026-09-05",
      cashUpDates: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
      reviewDates: ["2026-09-01", "2026-09-02", "2026-09-03"],
      creatorBatches: [],
      productByCreatorBatches: [],
    });
    expect(coverage.cashUp.status).toBe("ready");
    expect(coverage.reviews.status).toBe("partial");
    expect(coverage.salesByCreator.status).toBe("missing");
    expect(coverage.salesByCreator.complete).toBe(false);
    expect(coverage.salesByProductByCreator.status).toBe("missing");
  });
});
