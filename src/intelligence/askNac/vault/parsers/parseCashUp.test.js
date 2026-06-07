import { parseCashUpReport } from "./parseCashUp";
import { createIntermediate } from "./vaultIntermediate";

const SAMPLE_CASH_UP = [
  ["Friday 05/06/2026", ""],
  ["Total Sales", 41359],
  ["Net Sales", 35912.17],
  ["Guest Count", 444],
  ["Order Count", 480],
  ["Average per Guest", 80.88],
  ["CCM Sales", 5200],
  ["Talabat Sales", 3100],
  ["Breakfast Sales", 9000],
  ["Lunch Sales", 16000],
  ["Dinner Sales", 16359],
  ["Discounts", 890],
  ["Voids", 120],
  ["Target", 42000],
];

function wrapMatrix(matrix) {
  const text = matrix.map((row) => row.join(" | ")).join("\n");
  return createIntermediate({
    fileType: "xlsx",
    extension: "xlsx",
    matrix,
    text,
  });
}

describe("parseCashUpReport", () => {
  test("maps NAC cash-up row (Friday 05/06/2026)", () => {
    const result = parseCashUpReport(wrapMatrix(SAMPLE_CASH_UP), {
      fileId: "file-1",
      branchId: "khobar",
      brandWide: false,
      department: "admin",
      sensitivityLevel: "management",
      createdBy: "test@nac.com",
    });

    expect(result.ok).toBe(true);
    expect(result.periodStart).toBe("2026-06-05");
    expect(result.confidenceMeta.level).toMatch(/high|medium/);

    const net = result.facts.find((f) => f.metric_key === "net_sales");
    expect(net.metric_value).toBe(35912.17);

    const guests = result.facts.find((f) => f.metric_key === "guest_count");
    expect(guests.metric_value).toBe(444);

    const avg = result.facts.find((f) => f.metric_key === "avg_per_guest");
    expect(avg.metric_value).toBe(80.88);
  });
});
