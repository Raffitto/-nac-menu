import { BATCH_COVERAGE_COLUMNS, coveringBatchIds, getImportBatchItemCounts, getImportBatches, withUsableRowCounts } from "../../lib/foodicsApi";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { fetchCashUpCoverage } from "./cashUpSource";
import { fetchReviewTrackingCoverage } from "./reviewCoverage";
import { assessExportCoverage } from "./coverage";

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function settledError(result) {
  if (result.status !== "rejected") return null;
  const reason = result.reason;
  return reason?.message || String(reason || "failed");
}

export async function fetchFoodicsReadinessBatches({ from, to, branch, rbacProfile }) {
  const opts = {
    columns: BATCH_COVERAGE_COLUMNS,
    periodFrom: from,
    periodTo: to,
    branchId: branch,
  };
  const [creatorSettled, productSettled] = await Promise.allSettled([
    getImportBatches(12, IMPORT_TYPE.SALES_BY_CREATOR, rbacProfile, opts),
    getImportBatches(12, IMPORT_TYPE.WAITER_PRODUCT_SALES, rbacProfile, opts),
  ]);
  const creatorBatches = settledValue(creatorSettled, []);
  const productBatches = settledValue(productSettled, []);
  const countIds = [
    ...coveringBatchIds(creatorBatches, from, to),
    ...coveringBatchIds(productBatches, from, to),
  ];
  const counts = await getImportBatchItemCounts(countIds);
  return {
    creatorBatches: withUsableRowCounts(creatorBatches, counts),
    productBatches: withUsableRowCounts(productBatches, counts),
    integrityQueries: countIds.length,
    creatorError: settledError(creatorSettled),
    productError: settledError(productSettled),
  };
}

export async function fetchReportsReadiness(supabase, { from, to, branch, rbacProfile, onPartial } = {}) {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const timings = {};
  const mark = (name, ms, extra = {}) => {
    timings[name] = { ms, ...extra };
  };

  const cashP = (async () => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const value = await fetchCashUpCoverage(supabase, { branch, from, to });
    mark("cashUp", Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0), {
      dates: (value.cashUpDates || []).length,
      error: value.error || null,
    });
    return value;
  })();

  const reviewP = (async () => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const value = await fetchReviewTrackingCoverage(supabase, { branch, from, to });
    mark("reviews", Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0), {
      dates: (value.reviewDates || []).length,
      error: value.error || null,
    });
    return value;
  })();

  const foodicsP = (async () => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const value = await fetchFoodicsReadinessBatches({ from, to, branch, rbacProfile });
    mark("foodics", Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0), {
      creatorBatches: (value.creatorBatches || []).length,
      productBatches: (value.productBatches || []).length,
      integrityQueries: value.integrityQueries,
      error: value.creatorError || value.productError || null,
    });
    return value;
  })();

  const acc = {
    cashUpDates: [],
    reviewDates: [],
    creatorBatches: [],
    productByCreatorBatches: [],
  };

  const paint = () => {
    const coverage = assessExportCoverage({ from, to, ...acc });
    onPartial?.(coverage);
    return coverage;
  };

  cashP.then((cashUp) => {
    acc.cashUpDates = cashUp.cashUpDates || [];
    paint();
  }).catch(() => {});
  reviewP.then((reviewCoverage) => {
    acc.reviewDates = reviewCoverage.reviewDates || [];
    paint();
  }).catch(() => {});
  foodicsP.then((foodics) => {
    acc.creatorBatches = foodics.creatorBatches || [];
    acc.productByCreatorBatches = foodics.productBatches || [];
    paint();
  }).catch(() => {});

  const [cashSettled, reviewSettled, foodicsSettled] = await Promise.allSettled([cashP, reviewP, foodicsP]);
  const cashUp = settledValue(cashSettled, { cashUpDates: [], error: settledError(cashSettled) });
  const reviewCoverage = settledValue(reviewSettled, { reviewDates: [], error: settledError(reviewSettled) });
  const foodics = settledValue(foodicsSettled, {
    creatorBatches: [],
    productBatches: [],
    integrityQueries: 0,
    creatorError: settledError(foodicsSettled),
  });

  acc.cashUpDates = cashUp.cashUpDates || [];
  acc.reviewDates = reviewCoverage.reviewDates || [];
  acc.creatorBatches = foodics.creatorBatches || [];
  acc.productByCreatorBatches = foodics.productBatches || [];
  const coverage = paint();
  const totalMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);

  return {
    coverage,
    cashUp,
    reviewCoverage,
    creatorBatches: foodics.creatorBatches || [],
    productBatches: foodics.productBatches || [],
    timings: { ...timings, totalMs },
  };
}
