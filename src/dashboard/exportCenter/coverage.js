import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { missingDates, unionCoverage } from "./dateRange";

export function assessExportCoverage({
  from,
  to,
  cashUpDates = [],
  reviewAvailable = false,
  creatorBatches = [],
  productByCreatorBatches = [],
} = {}) {
  const cashMissing = missingDates(new Set(cashUpDates), from, to);
  const creator = unionCoverage(creatorBatches, from, to);
  const product = unionCoverage(productByCreatorBatches, from, to);

  return {
    from,
    to,
    cashUp: {
      id: "cash_up",
      label: "Cash Up",
      complete: cashMissing.length === 0,
      missing: cashMissing,
    },
    reviews: {
      id: "reviews",
      label: "Reviews",
      complete: Boolean(reviewAvailable),
      missing: reviewAvailable ? [] : [from, to].filter(Boolean),
    },
    salesByCreator: {
      id: IMPORT_TYPE.SALES_BY_CREATOR,
      label: "Sales by Creator",
      complete: creator.complete,
      missing: creator.missing,
    },
    salesByProductByCreator: {
      id: IMPORT_TYPE.WAITER_PRODUCT_SALES,
      label: "Sales by Product by Creator",
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
