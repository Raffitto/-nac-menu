import { parseWeeklyDashboardReport } from "./parseWeeklyDashboard";
import { buildWeeklyDashboardWorkbook } from "../../export/weeklyDashboardXlsxExport";
import * as XLSX from "xlsx";
import { inferWeeklyDashboardReportType, resolveDriveReportTypeFromPath } from "../weeklyDashboardReportType";
import {
  extractDocumentSearchTerms,
  isVaultDocumentSearchQuery,
  scoreVaultDocumentSearchIntent,
} from "../vaultDocumentSearchRouting";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../../intentRouter";

const samplePackage = {
  meta: {
    branch: "khobar",
    branchLabel: "Khobar",
    periodLabel: "week ending 2026-06-15",
    startDate: "2026-06-09",
    endDate: "2026-06-15",
    generatedAtLabel: "23 Jun 2026, 10:00",
  },
  weekAggregation: {
    totalSales: 125000,
    totalGuests: 820,
    averageSpend: 152.44,
    totalDeliverySales: 18000,
    totalDeliveryOrders: 210,
    dayCount: 5,
    topPlatformBySales: "Jahez",
  },
  manualInputs: { seven_rooms_covers: 82 },
  googleReviews: { totalReviews: 6, averageStars: 4.5, counts: { 5: 4, 4: 2, 3: 0, 2: 0, 1: 0 } },
  executiveSummaryLines: ["Khobar uploaded 5 cash-up day(s). Sales held steady despite humidity."],
  operationalCommentary: ["[Operator · weather] Humidity above 70% reduces walk-ins."],
  coverageAssessment: {
    confidence: "medium",
    coverageNotes: ["Partial coverage for requested week."],
    confidenceExplanation: "5 of 7 calendar days covered.",
  },
  confidenceResult: { level: "medium" },
  sourceRegistry: [],
  deliveryPlatforms: [{ platform: "Jahez", sales: 9000, orders: 95 }],
  topProducts: [{ rank: 1, itemName: "Truffle Burger", netSales: 4200, quantity: 88 }],
  leastProducts: [{ rank: 1, itemName: "Side Salad", netSales: 120, quantity: 12 }],
};

function workbookToIntermediate(workbook) {
  const dashboardSheet = workbook.Sheets.Dashboard;
  const rows = XLSX.utils.sheet_to_json(dashboardSheet, { header: 1, defval: "" });
  const text = rows.map((row) => row.filter(Boolean).join("\t")).join("\n");
  return { text, matrix: rows, sections: [{ label: "Dashboard" }] };
}

describe("parseWeeklyDashboardReport", () => {
  test("extracts metrics and executive insights from dashboard workbook", () => {
    const workbook = buildWeeklyDashboardWorkbook(samplePackage);
    const intermediate = workbookToIntermediate(workbook);
    const result = parseWeeklyDashboardReport(intermediate, {
      branchId: "khobar",
      fileId: "file-1",
      reportType: "weekly_dashboard",
    });

    expect(result.ok).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "total_sales")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "guest_count")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "executive_summary_line")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "operational_commentary_line")).toBe(true);
    expect(result.stats.sectionLines).toBeGreaterThan(0);
  });
});

describe("weeklyDashboardReportType", () => {
  test("infers weekly_dashboard from Executive Reports folder paths", () => {
    expect(inferWeeklyDashboardReportType("Weekly / Executive Reports / Weekly Dashboards")).toBe("weekly_dashboard");
    expect(resolveDriveReportTypeFromPath("Weekly Dashboards", "other")).toBe("weekly_dashboard");
    expect(resolveDriveReportTypeFromPath("Cashup 2026", "other")).toBe("cash_up");
  });
});

describe("weekly dashboard document search routing", () => {
  const query = "Show me everything learned from historical weekly dashboards.";

  test("routes historical weekly dashboard query to document search", () => {
    expect(isVaultDocumentSearchQuery(query)).toBe(true);
    expect(scoreVaultDocumentSearchIntent(query)).toBeGreaterThanOrEqual(32);
    expect(extractDocumentSearchTerms(query)).toBe("");
    const route = routeAskNacIntent(query, { branch: "khobar" });
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
  });
});
