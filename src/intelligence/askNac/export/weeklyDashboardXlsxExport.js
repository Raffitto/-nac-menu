/**
 * Weekly dashboard XLSX export — Dashboard, Data, Source, 90 Days sheets.
 */

import * as XLSX from "xlsx";
import { downloadBlob } from "../export/askNacExportPayload";

function cell(value) {
  if (value == null || value === "") return "—";
  return value;
}

function formatNumber(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n;
}

export function buildWeeklyDashboardFilename(pkg = {}) {
  const branch = String(pkg.meta?.branch || "branch").toLowerCase();
  const end = String(pkg.meta?.endDate || "").slice(0, 10) || "week";
  return `NAC-Weekly-Dashboard-${branch}-${end}.xlsx`;
}

export function buildWeeklyDashboardWorkbook(pkg = {}) {
  const wb = XLSX.utils.book_new();
  const meta = pkg.meta || {};
  const week = pkg.weekAggregation || {};
  const covers = pkg.manualInputs?.seven_rooms_covers;
  const confidence = pkg.confidenceResult?.level || pkg.coverageAssessment?.confidence || "—";

  const dashboardRows = [
    ["NAC Hospitality OS — Weekly Management Dashboard"],
    ["Branch", meta.branchLabel || meta.branch],
    ["Period", meta.periodLabel || `${meta.startDate} – ${meta.endDate}`],
    ["Generated", meta.generatedAtLabel || meta.generatedAt],
    ["Confidence", confidence],
    [],
    ["Executive Summary"],
    ...(pkg.executiveSummaryLines || []).map((line) => [line]),
    [],
    ["Sales Performance"],
    ["Total sales (SAR)", formatNumber(week.totalSales)],
    ["Cash-up days", formatNumber(week.dayCount)],
    ["Total orders", formatNumber(week.totalOrders)],
    [],
    ["Guest Performance"],
    ["Cash-up guests", formatNumber(week.totalGuests)],
    ["7Rooms covers (manual)", formatNumber(covers)],
    [],
    ["Average Spend"],
    ["Average spend (SAR)", formatNumber(week.averageSpend)],
    [],
    ["Delivery Performance"],
    ["Delivery sales (SAR)", formatNumber(week.totalDeliverySales)],
    ["Delivery orders", formatNumber(week.totalDeliveryOrders)],
    ["Top platform (sales)", cell(week.topPlatformBySales)],
    [],
    ["Delivery by platform"],
    ["Platform", "Sales (SAR)", "Orders"],
    ...(pkg.deliveryPlatforms || []).map((p) => [p.platform, formatNumber(p.sales), formatNumber(p.orders)]),
    [],
    ["Google Review Performance"],
    ["Total reviews (logbook)", formatNumber(pkg.googleReviews?.totalReviews)],
    ["Average stars", formatNumber(pkg.googleReviews?.averageStars)],
    ["5-star", formatNumber(pkg.googleReviews?.counts?.[5])],
    ["4-star", formatNumber(pkg.googleReviews?.counts?.[4])],
    ["3-star", formatNumber(pkg.googleReviews?.counts?.[3])],
    ["2-star", formatNumber(pkg.googleReviews?.counts?.[2])],
    ["1-star", formatNumber(pkg.googleReviews?.counts?.[1])],
    [],
    ["Top Products"],
    ["Rank", "Item", "Net sales (SAR)", "Quantity"],
    ...(pkg.topProducts || []).map((p) => [p.rank, p.itemName, formatNumber(p.netSales), formatNumber(p.quantity)]),
    [],
    ["Least Products"],
    ["Rank", "Item", "Net sales (SAR)", "Quantity"],
    ...(pkg.leastProducts || []).map((p) => [p.rank, p.itemName, formatNumber(p.netSales), formatNumber(p.quantity)]),
    [],
    ["Operational Commentary"],
    ...(pkg.operationalCommentary || []).map((line) => [line]),
    [],
    ["Coverage & Confidence"],
    ...(pkg.coverageAssessment?.coverageNotes || []).map((line) => [line]),
    [pkg.coverageAssessment?.confidenceExplanation || ""].filter(Boolean),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dashboardRows), "Dashboard");

  const dataRows = [
    ["Section", "Metric", "Value", "Period start", "Period end"],
    ["Sales", "total_sales", week.totalSales, meta.startDate, meta.endDate],
    ["Sales", "total_orders", week.totalOrders, meta.startDate, meta.endDate],
    ["Sales", "day_count", week.dayCount, meta.startDate, meta.endDate],
    ["Guests", "cash_up_guests", week.totalGuests, meta.startDate, meta.endDate],
    ["Guests", "seven_rooms_covers", covers, meta.startDate, meta.endDate],
    ["Spend", "average_spend", week.averageSpend, meta.startDate, meta.endDate],
    ["Delivery", "total_delivery_sales", week.totalDeliverySales, meta.startDate, meta.endDate],
    ["Delivery", "total_delivery_orders", week.totalDeliveryOrders, meta.startDate, meta.endDate],
    ["Google", "total_reviews", pkg.googleReviews?.totalReviews, meta.startDate, meta.endDate],
    ["Google", "average_stars", pkg.googleReviews?.averageStars, meta.startDate, meta.endDate],
  ];
  (pkg.deliveryPlatforms || []).forEach((p) => {
    dataRows.push(["Delivery platform", p.platform, p.sales, meta.startDate, meta.endDate]);
  });
  (week.dailyBreakdown || []).forEach((row) => {
    dataRows.push(
      ["Daily", "total_sales", row.totalSales, row.date, row.date],
      ["Daily", "total_guests", row.totalGuests, row.date, row.date],
      ["Daily", "average_spend", row.averageSpend, row.date, row.date],
    );
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataRows), "Data");

  const sourceRows = [
    ["Section", "Metric", "Value", "Source type", "Confidence", "Freshness", "Notes"],
    ...(pkg.sourceRegistry || []).map((r) => [
      r.section,
      r.metric,
      r.value,
      r.sourceType,
      r.confidence,
      r.freshness,
      r.notes,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sourceRows), "Source");

  const ninety = pkg.ninetyAggregation || {};
  const ninetyRows = [
    ["90-day trend · ending", meta.endDate],
    ["Total sales (SAR)", formatNumber(ninety.totalSales)],
    ["Total guests", formatNumber(ninety.totalGuests)],
    ["Average spend (SAR)", formatNumber(ninety.averageSpend)],
    ["Cash-up days", formatNumber(ninety.dayCount)],
    [],
    ["Date", "Sales (SAR)", "Guests", "Avg spend", "Delivery sales"],
    ...(ninety.dailyBreakdown || []).map((row) => [
      row.date,
      formatNumber(row.totalSales),
      formatNumber(row.totalGuests),
      formatNumber(row.averageSpend),
      formatNumber(row.totalDeliverySales),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ninetyRows), "90 Days");

  return wb;
}

export function exportWeeklyDashboardXlsx(pkg = {}) {
  if (!pkg?.meta) throw new Error("Weekly dashboard package is missing.");
  const wb = buildWeeklyDashboardWorkbook(pkg);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    buildWeeklyDashboardFilename(pkg),
  );
}

export function listWeeklyDashboardSheetNames(pkg = {}) {
  const wb = buildWeeklyDashboardWorkbook(pkg);
  return wb.SheetNames;
}
