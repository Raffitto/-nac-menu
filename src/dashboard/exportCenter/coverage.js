import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { foodicsSourceLabel, formatExportDate } from "./foodicsSourceGuide";
import { missingDates, unionCoverage } from "./dateRange";

export function assessReviewTrackingCoverage({ from, to, reviewDates = [] } = {}) {
  const dates = [...new Set((reviewDates || []).map((d) => String(d).slice(0, 10)))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const inRange = dates.filter((d) => (!from || d >= from) && (!to || d <= to));
  const missing = missingDates(new Set(inRange), from, to);
  const latest = inRange[inRange.length - 1] || dates.filter((d) => !to || d <= to).pop() || null;
  const throughLabel = latest ? formatExportDate(latest) : "";
  if (inRange.length && missing.length === 0) {
    return {
      id: "reviews",
      label: "Google Review Tracking",
      complete: true,
      status: "complete",
      throughDate: latest,
      missing: [],
      message: `✓ Google Review Tracking — Complete through ${throughLabel}`,
    };
  }
  if (inRange.length) {
    return {
      id: "reviews",
      label: "Google Review Tracking",
      complete: false,
      status: "partial",
      throughDate: latest,
      missing,
      message: `⚠ Google Review Tracking — Partial`,
      detail: `Complete through ${throughLabel}\nMissing ${missing.length === 1 ? formatExportDate(missing[0]) : `${formatExportDate(missing[0])} → ${formatExportDate(missing[missing.length - 1])}`}`,
    };
  }
  return {
    id: "reviews",
    label: "Google Review Tracking",
    complete: false,
    status: "missing",
    throughDate: latest,
    missing: [from, to].filter(Boolean),
    message: "⚠ Google Review Tracking missing / not synced for selected range",
  };
}

export function batchHasUsableRows(batch) {
  return Number(batch?.usable_row_count ?? batch?.row_count ?? 0) > 0;
}

export function assessFoodicsImportCoverage({
  from,
  to,
  batches = [],
  id,
  label,
} = {}) {
  const covering = (batches || []).filter(
    (b) => b?.period_start && b?.period_end && b.period_start <= to && b.period_end >= from,
  );
  const usable = covering.filter(batchHasUsableRows);
  const covered = unionCoverage(usable, from, to);
  if (covered.complete) {
    return {
      id,
      label,
      complete: true,
      status: "complete",
      missing: [],
      message: `✓ ${label} — Complete`,
    };
  }
  if (covering.length && !usable.length) {
    return {
      id,
      label,
      complete: false,
      status: "import_incomplete",
      missing: covered.missing,
      message: `⚠ ${label} — Import incomplete`,
      detail: "The file was received but no usable creator rows were stored.\nPlease upload the file again.",
    };
  }
  return {
    id,
    label,
    complete: false,
    status: "missing",
    missing: covered.missing,
    message: `Missing: ${label}`,
  };
}

export function assessExportCoverage({
  from,
  to,
  cashUpDates = [],
  reviewDates = [],
  creatorBatches = [],
  productByCreatorBatches = [],
} = {}) {
  const cashMissing = missingDates(new Set(cashUpDates), from, to);
  const cashPresent = (cashUpDates || []).filter((d) => d >= from && d <= to);
  const cashStatus = cashMissing.length === 0
    ? "ready"
    : cashPresent.length
      ? "partial"
      : "missing";
  const creator = assessFoodicsImportCoverage({
    from,
    to,
    batches: creatorBatches,
    id: IMPORT_TYPE.SALES_BY_CREATOR,
    label: foodicsSourceLabel(IMPORT_TYPE.SALES_BY_CREATOR),
  });
  const product = assessFoodicsImportCoverage({
    from,
    to,
    batches: productByCreatorBatches,
    id: IMPORT_TYPE.WAITER_PRODUCT_SALES,
    label: foodicsSourceLabel(IMPORT_TYPE.WAITER_PRODUCT_SALES),
  });
  if (product.status === "import_incomplete") {
    product.detail = "The file was received but no usable product rows were stored.\nPlease upload the file again.";
  }
  const reviews = assessReviewTrackingCoverage({ from, to, reviewDates });

  return {
    from,
    to,
    cashUp: {
      id: "cash_up",
      label: "Cash Up",
      complete: cashStatus === "ready",
      status: cashStatus,
      present: cashPresent,
      missing: cashMissing,
    },
    reviews,
    salesByCreator: creator,
    salesByProductByCreator: product,
  };
}

export function staffPerformanceReady(coverage) {
  return Boolean(coverage?.salesByCreator?.complete && coverage?.salesByProductByCreator?.complete);
}

export function cashUpReady(coverage) {
  return Boolean(coverage?.cashUp?.complete);
}

export function cashUpDownloadable(coverage) {
  return Boolean(coverage?.cashUp?.present?.length || coverage?.cashUp?.complete);
}

export function formatMissingDatesList(dates = []) {
  return (dates || []).join(", ");
}

export function formatMissingRange(dates = []) {
  if (!dates.length) return "";
  if (dates.length === 1) return dates[0];
  return `${dates[0]} → ${dates[dates.length - 1]}`;
}
