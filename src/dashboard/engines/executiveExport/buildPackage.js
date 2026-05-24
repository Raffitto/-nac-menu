/**
 * Executive export package — waiter import = sole sales truth.
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
import {
  aggregateSalesItemsByName,
  includeInBottomItemsList,
  validateSalesQuantityCoherence,
  filterExecutiveImportLines,
  filterExecutiveAggregatedItems,
} from "./salesRollup";
import { mergeWaiterRankingRows, mergeReviewWaiterStats } from "./waiterIdentity";
import { validateExecutiveExportIntegrity } from "./validateIntegrity";

export function buildExecutiveUnifiedExportPackage(input = {}) {
  const {
    exportRange = null,
    branchId = "khobar",
    salesItems = [],
    waiterItems = [],
    reviewEvents = [],
    upsellFocusItems = [],
    upsellGroupIds = [],
    salesBatch = null,
    menuSessions = 0,
  } = input;

  const items = (waiterItems?.length ? waiterItems : salesItems) || [];

  const periodAlignment = buildPeriodAlignmentBlock({
    exportRange,
    salesBatch,
    menuSessions,
    reviewEventCount: (reviewEvents || []).length,
  });

  const salesOverlap =
    salesBatch &&
    periodAlignment.sales.coverageStart &&
    periodAlignment.sales.coverageEnd &&
    !periodAlignment.sales.warning?.includes("does not overlap");

  const salesUsable = salesOverlap && items.length > 0;

  const executiveImportLines = salesUsable ? filterExecutiveImportLines(items) : [];

  const salesValidation = buildWaiterImportValidation(salesUsable ? items : []);
  const salesIntegrity = salesUsable
    ? validateImportBatchIntegrity(items, salesValidation.totals)
    : { valid: false, integrity_failure: true, message: periodAlignment.sales.warning };

  const aggregatedExecutive = salesUsable ? aggregateSalesItemsByName(items) : [];
  const aggregatedFull = salesUsable ? aggregateSalesItemsByName(items, { executiveOnly: false }) : [];
  const qtyCoherence = salesUsable
    ? validateSalesQuantityCoherence(aggregatedFull, salesValidation.totals)
    : { valid: true };

  const integrityOk =
    salesUsable && salesIntegrity.valid && qtyCoherence.valid;

  const withQty = filterExecutiveAggregatedItems(
    aggregatedExecutive.filter((r) => r.quantity > 0),
  );
  const bottomCandidates = withQty.filter(includeInBottomItemsList);

  const waiterIntel = salesUsable
    ? buildWaiterSalesIntelligence(executiveImportLines.length ? executiveImportLines : items, {
        focusItems: upsellFocusItems,
        salesMetric: "net_sales",
      })
    : { all: [], waiters: [] };

  const { rows: mergedWaiterSales } = mergeWaiterRankingRows(
    (waiterIntel.all || []).map((w) => ({
      waiter: w.waiter,
      net_sales: w.net_sales,
      quantity: w.quantity,
      role: w.roleLabel || w.role,
    })),
    { sumKeys: ["net_sales", "quantity"] },
  );

  const waiterSalesSource = mergedWaiterSales;

  const upsellSource = upsellFocusItems.length
    ? mergeWaiterRankingRows(
        (waiterIntel.all || []).map((w) => {
          const focusQty = (w.focusPerformance || []).reduce((sum, f) => sum + (Number(f.qty) || 0), 0);
          const focusRev = (w.focusPerformance || []).reduce((sum, f) => sum + (Number(f.revenue) || 0), 0);
          return {
            waiter: w.waiter,
            quantity: focusQty,
            net_sales: focusRev,
            role: w.roleLabel || w.role,
          };
        }),
        { sumKeys: ["quantity", "net_sales"] },
      ).rows
    : [];

  const khobarEvents = (reviewEvents || []).filter((e) => normalizeBranchId(e.branch_id) === "khobar");
  const khobarStaffRaw = filterProductionStaffList(aggregateStaffReviewStats(khobarEvents));
  const { staff: khobarStaffMerged, audit: khobarWaiterAudit } = mergeReviewWaiterStats(khobarStaffRaw);
  const khobarSource = khobarStaffMerged.map((s) => ({
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

  const integrityMessage =
    salesIntegrity.message ||
    qtyCoherence.message ||
    (!integrityOk && periodAlignment.coverageNote) ||
    null;

  const sections = {
    topItems: buildTopItemsSection({
      rows: withQty,
      coverage: periodAlignment.sales,
      integrityOk,
    }),
    bottomItems: buildBottomItemsSection({
      rows: bottomCandidates,
      coverage: periodAlignment.sales,
      integrityOk,
    }),
    waiterSales: buildWaiterSalesSection({
      rows: waiterSalesSource,
      coverage: periodAlignment.sales,
      integrityOk,
    }),
    waiterUpsell: buildWaiterUpsellSection({
      rows: upsellSource,
      coverage: periodAlignment.sales,
      focusLabel,
      integrityOk,
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
    trackingIntegrity: {
      score: menuSessions >= 50 ? 88 : menuSessions >= 10 ? 62 : periodAlignment.menu.partial ? 35 : 70,
    },
    sessionDensity: { score: Math.min(100, Math.round(menuSessions * 1.2)) },
    attributionConfidence: { score: periodAlignment.reportPartial ? 45 : 72 },
    branchCoverage: { score: salesUsable ? 88 : 40 },
    visibilityConfidence: { score: salesIntegrity.valid ? 78 : 40 },
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
    dataSourceNote:
      "Operational sales import (Foodics by creator) · menu_events behavior · review_events reputation",
    salesBatchLabel: salesBatch ? `${salesBatch.period_start} → ${salesBatch.period_end}` : null,
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

  const executiveValidation = validateExecutiveExportIntegrity({
    sections,
    summary,
  });

  return {
    version: EXECUTIVE_EXPORT_VERSION,
    meta: {
      ...meta,
      executiveIntegrity: {
        excludedImportLines: Math.max(0, items.length - executiveImportLines.length),
        khobarWaiterAliasesMerged: khobarWaiterAudit?.length || 0,
        validation: executiveValidation,
      },
    },
    trust,
    periodAlignment,
    summary,
    sections,
    upsellFocusItems,
    upsellGroupIds,
    importIntegrity: {
      sales: salesIntegrity,
      quantityCoherence: qtyCoherence,
      valid: integrityOk,
      message: integrityMessage,
    },
    provisional: periodAlignment.reportPartial || !integrityOk,
    suppressRankings: !integrityOk,
    totals: {
      sales: salesValidation.totals,
    },
    topItems: sections.topItems,
    bottomItems: sections.bottomItems,
    waiterSales: sections.waiterSales,
    waiterUpsell: sections.waiterUpsell,
    khobarGoogle: sections.khobarGoogle,
    executiveValidation,
  };
}
