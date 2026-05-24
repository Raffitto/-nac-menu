/**
 * Period alignment — sales (waiter import), menu_events, review_events.
 */

import { NAC_ANALYTICS_EPOCH_START, isEpochExportRange } from "../../config/operationalEpoch";

function parseDateKey(d) {
  if (!d) return null;
  return String(d).slice(0, 10);
}

/** @returns coverage assessment for a Foodics sales batch */
export function assessImportCoverage(batch, exportRange) {
  const requestedStart = parseDateKey(exportRange?.startDate);
  const requestedEnd = parseDateKey(exportRange?.endDate);

  if (!batch) {
    return {
      aligned: false,
      partial: true,
      coverageStart: null,
      coverageEnd: null,
      requestedStart,
      requestedEnd,
      warning: "No operational sales import found for this branch and period.",
      batchLabel: null,
    };
  }

  const coverageStart = parseDateKey(batch.period_start);
  const coverageEnd = parseDateKey(batch.period_end);

  if (!requestedStart || !requestedEnd) {
    return {
      aligned: true,
      partial: false,
      coverageStart,
      coverageEnd,
      requestedStart,
      requestedEnd,
      warning: null,
      batchLabel: `${coverageStart} to ${coverageEnd}`,
    };
  }

  const coversStart = coverageStart <= requestedStart;
  const coversEnd = coverageEnd >= requestedEnd;
  const aligned = coversStart && coversEnd;
  const overlaps = coverageStart <= requestedEnd && coverageEnd >= requestedStart;
  const partial = !aligned && overlaps;

  let warning = null;
  if (!overlaps) {
    warning = `Sales import (${coverageStart} to ${coverageEnd}) does not overlap the selected report range (${requestedStart} to ${requestedEnd}). Section omitted.`;
  } else if (partial) {
    warning = `Partial sales coverage: import spans ${coverageStart} to ${coverageEnd}; report range is ${requestedStart} to ${requestedEnd}.`;
  }

  return {
    aligned,
    partial: partial || (!aligned && overlaps),
    coverageStart,
    coverageEnd,
    requestedStart,
    requestedEnd,
    warning,
    batchLabel: `${coverageStart} to ${coverageEnd}`,
  };
}

function assessMenuCoverage(exportRange, menuSessions = 0) {
  const inEpoch = isEpochExportRange(exportRange);
  const silent = inEpoch && menuSessions <= 0;
  return {
    aligned: menuSessions > 0,
    partial: silent,
    warning: silent ? "No menu tracking sessions in the selected period." : null,
    batchLabel: exportRange?.periodLabel || null,
    sessions: menuSessions,
  };
}

function assessReviewCoverage(exportRange, reviewEventCount = 0) {
  const inEpoch = isEpochExportRange(exportRange);
  const missing = inEpoch && reviewEventCount <= 0;
  return {
    aligned: reviewEventCount > 0,
    partial: missing,
    warning: missing ? "No review scan events in the selected period." : null,
    batchLabel: exportRange?.periodLabel || null,
    eventCount: reviewEventCount,
  };
}

/**
 * Three-layer alignment: sales import, menu behavior, review reputation.
 */
export function buildPeriodAlignmentBlock({
  exportRange,
  salesBatch = null,
  menuSessions = 0,
  reviewEventCount = 0,
}) {
  const sales = assessImportCoverage(salesBatch, exportRange);
  const menu = assessMenuCoverage(exportRange, menuSessions);
  const review = assessReviewCoverage(exportRange, reviewEventCount);

  const inEpoch = isEpochExportRange(exportRange);
  const preEpoch =
    exportRange?.startDate && parseDateKey(exportRange.startDate) < NAC_ANALYTICS_EPOCH_START;

  const issues = [sales.warning, menu.warning, review.warning].filter(Boolean);
  let reportPartial =
    !sales.aligned ||
    sales.partial ||
    (inEpoch && (menu.partial || review.partial));

  let coverageNote = issues.length ? issues.join(" ") : null;
  if (preEpoch) {
    coverageNote = `Report range starts before trusted epoch (${NAC_ANALYTICS_EPOCH_START}). Post-epoch metrics are authoritative.`;
    reportPartial = true;
  }

  return {
    sales,
    menu,
    review,
    reportPartial,
    coverageNote,
    inEpoch,
    preEpoch,
    // Legacy alias — executive code previously read .product / .waiter
    waiter: sales,
  };
}

export function formatCoverageSubtitle(coverage) {
  if (!coverage) return null;
  if (coverage.warning) return coverage.warning;
  if (coverage.batchLabel) return `Coverage: ${coverage.batchLabel}`;
  return null;
}
