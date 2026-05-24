/**
 * Executive export package builder — orchestrates sections, alignment, briefing.
 */

import {
  validateImportBatchIntegrity,
  computeOperationalTrustScore,
} from "../../../platform/engines/reportTruthEngine";
import { CONFIDENCE_LABELS } from "../../../platform/contracts/dataConfidence";
import { buildWaiterImportValidation } from "../../utils/waiterImportValidation";
import { buildWaiterSalesIntelligence } from "../waiterSalesEngine";
import { aggregateStaffReviewStats } from "../../utils/staffReviewStats";
import { filterProductionStaffList } from "../../utils/isProductionStaff";
import { normalizeBranchId } from "../../utils/branchIdentity";
import { EXECUTIVE_EXPORT_VERSION } from "./contract";
import { buildPeriodAlignmentBlock } from "./periodAlignment";
import { buildExecutiveSummaryPage, buildExecutiveReportFilename } from "./insights";
import {
  buildTopItemsSection,
  buildBottomItemsSection,
  buildWaiterSalesSection,
  buildWaiterUpsellSection,
  buildKhobarGoogleSection,
} from "./buildSections";
import { aggregateProductItemsByName, includeInBottomItemsList } from "./productRollup";

export function buildExecutiveUnifiedExportPackage(input = {}) {
  const {
    exportRange = null,
    branchId = "khobar",
    productItems = [],
    waiterItems = [],
    reviewEvents = [],
    upsellFocusItems = [],
    upsellGroupIds = [],
    productBatch = null,
    waiterBatch = null,
  } = input;

  const periodAlignment = buildPeriodAlignmentBlock({ exportRange, productBatch, waiterBatch });

  const productOverlap =
    productBatch &&
    periodAlignment.product.coverageStart &&
    periodAlignment.product.coverageEnd &&
    !periodAlignment.product.warning?.includes("does not overlap");
  const waiterOverlap =
    waiterBatch &&
    periodAlignment.waiter.coverageStart &&
    periodAlignment.waiter.coverageEnd &&
    !periodAlignment.waiter.warning?.includes("does not overlap");

  const productUsable = productOverlap && (productItems?.length > 0 || productBatch);
  const waiterUsable = waiterOverlap && (waiterItems?.length > 0 || waiterBatch);

  const productValidation = buildWaiterImportValidation(productUsable ? productItems : []);
  const waiterValidation = buildWaiterImportValidation(waiterUsable ? waiterItems : []);
  const productIntegrity = productUsable
    ? validateImportBatchIntegrity(productItems, productValidation.totals)
    : { valid: false, integrity_failure: true, message: periodAlignment.product.warning };
  const waiterIntegrity = waiterUsable
    ? validateImportBatchIntegrity(waiterItems, waiterValidation.totals)
    : { valid: false, integrity_failure: true, message: periodAlignment.waiter.warning };

  const integrityOk = productUsable && productIntegrity.valid && (!waiterUsable || waiterIntegrity.valid);

  const aggregated = productUsable ? aggregateProductItemsByName(productItems) : [];
  const withQty = aggregated.filter((r) => r.quantity > 0);
  const bottomCandidates = withQty.filter(includeInBottomItemsList);

  const waiterIntel = waiterUsable
    ? buildWaiterSalesIntelligence(waiterItems, {
        focusItems: upsellFocusItems,
        salesMetric: "net_sales",
      })
    : { all: [], waiters: [] };

  const waiterSalesSource = (waiterIntel.all || []).map((w) => ({
    waiter: w.waiter,
    net_sales: w.net_sales,
    quantity: w.quantity,
    role: w.roleLabel || w.role,
  }));

  const upsellSource = upsellFocusItems.length
    ? (waiterIntel.all || []).map((w) => {
        const focusQty = (w.focusPerformance || []).reduce((sum, f) => sum + (Number(f.qty) || 0), 0);
        const focusRev = (w.focusPerformance || []).reduce((sum, f) => sum + (Number(f.revenue) || 0), 0);
        return {
          waiter: w.waiter,
          quantity: focusQty,
          net_sales: focusRev,
          role: w.roleLabel || w.role,
        };
      })
    : [];

  const khobarEvents = (reviewEvents || []).filter((e) => normalizeBranchId(e.branch_id) === "khobar");
  const khobarStaff = filterProductionStaffList(aggregateStaffReviewStats(khobarEvents));
  const khobarSource = khobarStaff.map((s) => ({
    waiter: s.name,
    google_redirects: s.google,
    qr_scans: s.scans,
    conversion_pct: s.conversion_pct,
  }));

  const focusLabel = [
    upsellGroupIds.length ? `Groups: ${upsellGroupIds.join(", ")}` : null,
    upsellFocusItems.length ? upsellFocusItems.slice(0, 5).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const sections = {
    topItems: buildTopItemsSection({
      rows: withQty,
      coverage: periodAlignment.product,
      integrityOk: productUsable && productIntegrity.valid,
    }),
    bottomItems: buildBottomItemsSection({
      rows: bottomCandidates,
      coverage: periodAlignment.product,
      integrityOk: productUsable && productIntegrity.valid,
    }),
    waiterSales: buildWaiterSalesSection({
      rows: waiterSalesSource,
      coverage: periodAlignment.waiter,
      integrityOk: waiterUsable && waiterIntegrity.valid,
    }),
    waiterUpsell: buildWaiterUpsellSection({
      rows: upsellSource,
      coverage: periodAlignment.waiter,
      focusLabel,
      integrityOk: waiterUsable && waiterIntegrity.valid,
    }),
    khobarGoogle: buildKhobarGoogleSection({
      rows: khobarSource,
      coverage: periodAlignment.review,
    }),
  };

  const operationalTrust = computeOperationalTrustScore({
    importIntegrity: {
      valid: integrityOk,
      integrity_failure: !integrityOk,
    },
    trackingIntegrity: { score: khobarEvents.length > 20 ? 80 : 50 },
    sessionDensity: { score: Math.min(100, khobarEvents.length) },
    attributionConfidence: { score: periodAlignment.reportPartial ? 45 : 72 },
    branchCoverage: { score: productUsable && waiterUsable ? 88 : 55 },
    visibilityConfidence: { score: productIntegrity.valid ? 75 : 40 },
  });

  const confidenceLevel =
    operationalTrust.tier === "trusted"
      ? CONFIDENCE_LABELS.high || "High"
      : operationalTrust.tier === "provisional"
        ? CONFIDENCE_LABELS.medium || "Medium"
        : CONFIDENCE_LABELS.low || "Low";

  const generatedAtLabel = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const branchLabel = branchId ? branchId.charAt(0).toUpperCase() + branchId.slice(1) : "All";

  const meta = {
    generatedAt: new Date().toISOString(),
    generatedAtLabel,
    periodLabel: exportRange?.periodLabel || "Selected period",
    exportStartDate: exportRange?.startDate,
    exportEndDate: exportRange?.endDate,
    branchId,
    branchLabel,
    dataSourceNote: "Foodics product + waiter imports · Khobar review QR / Google redirect events",
    productBatchLabel: productBatch ? `${productBatch.period_start} → ${productBatch.period_end}` : null,
    waiterBatchLabel: waiterBatch ? `${waiterBatch.period_start} → ${waiterBatch.period_end}` : null,
    filenameBase: buildExecutiveReportFilename({
      branchId,
      exportStartDate: exportRange?.startDate,
      exportEndDate: exportRange?.endDate,
    }),
  };

  const trust = {
    score: operationalTrust.score,
    tier: operationalTrust.tier,
    confidenceLabel: periodAlignment.reportPartial ? "Partial period" : confidenceLevel,
  };

  const summary = buildExecutiveSummaryPage({
    meta,
    trust,
    topItems: sections.topItems,
    bottomItems: sections.bottomItems,
    waiterSales: sections.waiterSales,
    waiterUpsell: sections.waiterUpsell,
    khobarGoogle: sections.khobarGoogle,
    periodAlignment,
    waiterIntel,
  });

  return {
    version: EXECUTIVE_EXPORT_VERSION,
    meta,
    trust,
    periodAlignment,
    summary,
    sections,
    upsellFocusItems,
    upsellGroupIds,
    importIntegrity: {
      product: productIntegrity,
      waiter: waiterIntegrity,
      valid: integrityOk,
    },
    provisional: periodAlignment.reportPartial || !integrityOk,
    suppressRankings: !integrityOk,
    totals: {
      product: productValidation.totals,
      waiter: waiterValidation.totals,
    },
    topItems: sections.topItems,
    bottomItems: sections.bottomItems,
    waiterSales: sections.waiterSales,
    waiterUpsell: sections.waiterUpsell,
    khobarGoogle: sections.khobarGoogle,
  };
}
