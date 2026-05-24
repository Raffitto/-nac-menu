/**
 * Period alignment — never silently merge mismatched Foodics vs report ranges.
 */

function parseDateKey(d) {
  if (!d) return null;
  return String(d).slice(0, 10);
}

/** @returns {{ aligned: boolean, partial: boolean, coverageStart, coverageEnd, requestedStart, requestedEnd, warning }} */
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
      warning: "No Foodics import batch found for this branch and period.",
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
    };
  }

  const coversStart = coverageStart <= requestedStart;
  const coversEnd = coverageEnd >= requestedEnd;
  const aligned = coversStart && coversEnd;
  const overlaps = coverageStart <= requestedEnd && coverageEnd >= requestedStart;
  const partial = !aligned && overlaps;

  let warning = null;
  if (!overlaps) {
    warning = `Import batch (${coverageStart} to ${coverageEnd}) does not overlap the selected report range (${requestedStart} to ${requestedEnd}). Section omitted.`;
  } else if (partial) {
    warning = `Partial coverage: Foodics import spans ${coverageStart} to ${coverageEnd}; report range is ${requestedStart} to ${requestedEnd}. Figures reflect import batch only.`;
  }

  return {
    aligned,
    partial: partial || !aligned,
    coverageStart,
    coverageEnd,
    requestedStart,
    requestedEnd,
    warning,
    batchLabel: `${coverageStart} to ${coverageEnd}`,
  };
}

export function buildPeriodAlignmentBlock({ exportRange, productBatch, waiterBatch }) {
  const product = assessImportCoverage(productBatch, exportRange);
  const waiter = assessImportCoverage(waiterBatch, exportRange);
  const review = {
    aligned: true,
    partial: false,
    coverageStart: exportRange?.startDate,
    coverageEnd: exportRange?.endDate,
    requestedStart: exportRange?.startDate,
    requestedEnd: exportRange?.endDate,
    warning: null,
    batchLabel: exportRange?.periodLabel || null,
  };

  const reportPartial = product.partial || waiter.partial || !product.aligned || !waiter.aligned;

  return {
    product,
    waiter,
    review,
    reportPartial,
    coverageNote: reportPartial
      ? [
          product.warning,
          waiter.warning,
        ]
          .filter(Boolean)
          .join(" ")
      : null,
  };
}

export function formatCoverageSubtitle(coverage) {
  if (!coverage) return null;
  if (coverage.warning) return coverage.warning;
  if (coverage.batchLabel) return `Coverage: ${coverage.batchLabel}`;
  return null;
}
