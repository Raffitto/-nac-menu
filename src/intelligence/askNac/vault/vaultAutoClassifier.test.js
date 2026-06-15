import { classifyVaultUpload, mergeAutoClassification } from "./vaultAutoClassifier";

describe("vaultAutoClassifier", () => {
  test("detects daily logbook from filename", () => {
    const result = classifyVaultUpload({
      filename: "Khobar daily logbook June 2026.xlsx",
      metadata: {},
    });
    expect(result.detectedReportType).toBe("daily_logbook");
    expect(result.detectedBranch).toBe("khobar");
    expect(result.classificationConfidence).toBeGreaterThan(0.5);
    expect(result.allowManualOverride).toBe(true);
  });

  test("detects NAC Khobar logbook day-month filename", () => {
    const result = classifyVaultUpload({
      filename: "14_June_NAC_Khobar_Logbook.docx.pdf",
      metadata: {},
    });
    expect(result.detectedReportType).toBe("daily_logbook");
    expect(result.detectedBranch).toBe("khobar");
    expect(result.detectedPeriod.periodStart).toBe("2026-06-14");
    expect(result.detectedPeriod.periodEnd).toBe("2026-06-14");
  });

  test("detects foodics export and sales department", () => {
    const result = classifyVaultUpload({
      filename: "Riyadh foodics waiter sales May.xlsx",
      metadata: {},
    });
    expect(result.detectedReportType).toBe("foodics_export");
    expect(result.detectedBranch).toBe("riyadh");
    expect(result.detectedDepartment).toBe("sales");
  });

  test("respects manual override when provided", () => {
    const merged = mergeAutoClassification(
      {
        reportType: "cash_up",
        branch: "jeddah",
        useAutoClassification: true,
      },
      classifyVaultUpload({ filename: "random.txt", metadata: {} }),
    );
    expect(merged.reportType).toBe("cash_up");
    expect(merged.branch).toBe("jeddah");
  });
});
