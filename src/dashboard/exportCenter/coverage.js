import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { foodicsSourceLabel, formatExportDate } from "./foodicsSourceGuide";
import { missingDates, unionCoverage } from "./dateRange";

export function assessReviewTrackingCoverage({ from, to, reviewDates = [] } = {}) {
  const dates = [...new Set((reviewDates || []).map((d) => String(d).slice(0, 10)))]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const latest = dates.filter((d) => !to || d <= to).pop() || null;
  const overlaps = dates.some((d) => d >= from && d <= to);
  const complete = Boolean(latest && overlaps && latest >= to);
  const throughLabel = latest ? formatExportDate(latest) : "";
  return {
    id: "reviews",
    label: "Google Review Tracking",
    complete,
    throughDate: latest,
    missing: complete ? [] : [from, to].filter(Boolean),
    message: complete
      ? `✓ Google Review Tracking — Complete through ${throughLabel}`
      : "⚠ Google Review Tracking missing / not synced for selected range",
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
  const creator = unionCoverage(creatorBatches, from, to);
  const product = unionCoverage(productByCreatorBatches, from, to);
  const reviews = assessReviewTrackingCoverage({ from, to, reviewDates });

  return {
    from,
    to,
    cashUp: {
      id: "cash_up",
      label: "Cash Up",
      complete: cashMissing.length === 0,
      missing: cashMissing,
    },
    reviews,
    salesByCreator: {
      id: IMPORT_TYPE.SALES_BY_CREATOR,
      label: foodicsSourceLabel(IMPORT_TYPE.SALES_BY_CREATOR),
      complete: creator.complete,
      missing: creator.missing,
    },
    salesByProductByCreator: {
      id: IMPORT_TYPE.WAITER_PRODUCT_SALES,
      label: foodicsSourceLabel(IMPORT_TYPE.WAITER_PRODUCT_SALES),
      complete: product.complete,
      missing: product.missing,
    },
  };
}

export function staffPerformanceReady(coverage) {
  return Boolean(coverage?.salesByProductByCreator?.complete);
}

export function cashUpReady(coverage) {
  return Boolean(coverage?.cashUp?.complete);
}

export function formatMissingRange(dates = []) {
  if (!dates.length) return "";
  if (dates.length === 1) return dates[0];
  return `${dates[0]} → ${dates[dates.length - 1]}`;
}
