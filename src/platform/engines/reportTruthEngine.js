/**
 * Report truth enforcement — import validation, zero filter, operational trust, safe mode.
 */

import { CONFIDENCE } from "../contracts/dataConfidence";
import {
  REPORT_TRUTH,
  MODIFIER_SEMANTIC_CLASSES,
  INSUFFICIENT_MENU_SAMPLE,
  IMPORT_MISMATCH,
} from "../contracts/reportTruthContract";
import { classifyVisibilitySalesQuadrant } from "./conversionMetricsEngine";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Strict quantity + net sales equality vs batch totals. */
export function validateImportBatchIntegrity(rows = [], batchTotals = {}) {
  const list = rows || [];
  const sumQty = list.reduce((a, r) => a + (Number(r.quantity_sold) || 0), 0);
  const sumNet = round2(list.reduce((a, r) => a + (Number(r.net_sales) || 0), 0));
  const expectedQty = Number(batchTotals.quantity ?? batchTotals.qty);
  const expectedNet = round2(Number(batchTotals.net_sales ?? batchTotals.net));

  const qtyValid =
    !Number.isFinite(expectedQty) || sumQty === expectedQty;
  const netDiff =
    Number.isFinite(expectedNet) ? Math.abs(sumNet - expectedNet) : 0;
  const netValid =
    !Number.isFinite(expectedNet) ||
    netDiff <= REPORT_TRUTH.import.netSalesToleranceSar;

  const failures = [];
  if (!qtyValid) {
    failures.push({
      type: "quantity_mismatch",
      message: `Imported quantity ${sumQty} ≠ batch total ${expectedQty}`,
      sum: sumQty,
      expected: expectedQty,
    });
  }
  if (!netValid) {
    failures.push({
      type: "net_sales_mismatch",
      message: `Imported net sales ${sumNet} SAR ≠ batch total ${expectedNet} SAR (Δ ${netDiff})`,
      sum: sumNet,
      expected: expectedNet,
      diff: netDiff,
    });
  }

  return {
    valid: failures.length === 0,
    integrity_failure: failures.length > 0,
    failures,
    sums: { quantity: sumQty, net_sales: sumNet },
    expected: { quantity: expectedQty, net_sales: expectedNet },
    provisional: failures.length > 0,
    message: failures.length ? IMPORT_MISMATCH : null,
  };
}

export function isModifierOrAddonRow(row = {}) {
  if (row.track_as_modifier) return true;
  const sem = String(row.semantic_class || row.foodics_class || "").toLowerCase();
  if (MODIFIER_SEMANTIC_CLASSES.has(sem)) return true;
  if (row.kind === "addon" || row.matched_kind === "addon") return true;
  return false;
}

/** Exclude zero-noise rows from executive surfaces unless mapped modifier. */
export function filterExecutiveRow(row = {}) {
  const views = Number(row.item_views ?? row.item_impressions) || 0;
  const opens = Number(row.item_modal_opens ?? row.item_opens) || 0;
  const sales = Number(row.quantity_sold ?? row.orders) || 0;
  const net = Number(row.net_sales) || 0;
  const interaction = views + opens;

  const allZero = views === 0 && sales === 0 && net === 0 && interaction === 0;

  if (!allZero) return true;

  const mapped = Boolean(row.matched_menu_item_id || row.matched_menu_item_name);
  if (mapped && isModifierOrAddonRow(row)) return true;

  return false;
}

export function filterExecutiveRows(rows = []) {
  return (rows || []).filter(filterExecutiveRow);
}

/** Executive-safe mode — suppress misleading KPIs. */
export function isExecutiveReportSafe(row = {}) {
  if (row.insufficient_sample || row.provisional) return false;
  if (row.conversion_allowed === false) return false;
  if (row.integrity_failure) return false;
  const conf = row.tracking_confidence || row.confidence || CONFIDENCE.LOW;
  const rank = { high: 3, medium: 2, low: 1 };
  return (rank[conf] || 0) >= (rank[REPORT_TRUTH.executive.minConfidenceToShow] || 2);
}

export function formatExecutiveConversion(row = {}) {
  if (row.integrity_failure) return IMPORT_MISMATCH;
  if (row.trust_label && row.offline_driven) return row.trust_label;
  if (row.insufficient_sample || !row.conversion_allowed) return INSUFFICIENT_MENU_SAMPLE;
  if (row.conversion_display) return row.conversion_display;
  if (row.impression_conversion_pct != null) return `${row.impression_conversion_pct}%`;
  return "—";
}

/** 0–100 operational trust score for reporting. */
export function computeOperationalTrustScore({
  importIntegrity = null,
  trackingIntegrity = null,
  attributionConfidence = null,
  branchCoverage = null,
  sessionDensity = null,
  visibilityConfidence = null,
} = {}) {
  const components = {
    import_integrity: importIntegrity?.valid === false ? 35 : importIntegrity?.valid === true ? 92 : 70,
    tracking_integrity: trackingIntegrity?.score ?? 70,
    attribution_confidence: attributionConfidence?.score ?? 55,
    branch_coverage: branchCoverage?.score ?? 75,
    session_density: sessionDensity?.score ?? 65,
    visibility_confidence: visibilityConfidence?.score ?? 60,
  };

  if (importIntegrity?.integrity_failure) {
    Object.keys(components).forEach((k) => {
      components[k] = Math.min(components[k], 45);
    });
  }

  const weights = {
    import_integrity: 0.22,
    tracking_integrity: 0.2,
    attribution_confidence: 0.18,
    branch_coverage: 0.12,
    session_density: 0.14,
    visibility_confidence: 0.14,
  };

  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    score += (components[k] || 0) * w;
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  const tier =
    score >= 82 ? "trusted" : score >= 62 ? "provisional" : score >= 42 ? "caution" : "untrusted";

  return {
    score,
    tier,
    components,
    report_safe: tier === "trusted" || tier === "provisional",
    generated_at: new Date().toISOString(),
  };
}

export function enrichRowWithReportTruth(row = {}, context = {}) {
  const quad = classifyVisibilitySalesQuadrant(row, row.tracking_confidence || row.confidence);
  return {
    ...row,
    visibility_quadrant: quad.quadrant,
    visibility_quadrant_label: quad.label,
    executive_safe: isExecutiveReportSafe(row),
    conversion_display: formatExecutiveConversion(row),
    report_provisional: context.importIntegrity?.provisional || row.provisional,
  };
}

export { INSUFFICIENT_MENU_SAMPLE, IMPORT_MISMATCH };
