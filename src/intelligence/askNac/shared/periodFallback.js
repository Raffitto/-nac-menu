/**
 * Foodics period resolution with safe defaults when the question omits a period.
 */

import { parseFoodicsPeriodFromQuestion } from "../foodics/foodicsPeriodParser";
import { getLatestBatchByType } from "../../../lib/foodicsApi";
import { IMPORT_TYPE } from "../../../dashboard/config/foodicsImportTypes";
import { MONTH_HOURS } from "../../../dashboard/utils/rangeState";
import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";

const DEFAULT_IMPORT_TYPE = IMPORT_TYPE.WAITER_PRODUCT_SALES;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthBounds(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const startDate = `${year}-${pad2(monthIndex + 1)}-01`;
  const endDate = `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}`;
  const label = new Date(Date.UTC(year, monthIndex, 1, 12)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { startDate, endDate, label };
}

function filterMtdPeriod(referenceDate = new Date()) {
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth();
  const period = monthBounds(y, m);
  return {
    period,
    source: "filter_mtd",
    warnings: [`No period in question — using platform filter: Month-to-date (${period.label}).`],
  };
}

function latestBatchPeriod(batch) {
  if (!batch?.period_start || !batch?.period_end) return null;
  const fileLabel = batch.source_file_name || batch.id;
  return {
    period: {
      startDate: batch.period_start,
      endDate: batch.period_end,
      label: `Latest Foodics import (${batch.period_start} to ${batch.period_end})`,
    },
    source: "latest_batch",
    warnings: [
      `No period in question — using latest uploaded Foodics batch (${fileLabel}).`,
    ],
  };
}

/**
 * Resolve a Foodics period from question text, platform filters, or latest batch.
 *
 * @returns {{ period: object|null, source: string|null, warnings: string[] }}
 */
export async function resolveFoodicsPeriodWithFallback(
  supabase,
  { question = "", filters = {}, branch = null, profile = null } = {},
) {
  const parsed = parseFoodicsPeriodFromQuestion(question);
  if (parsed?.startDate && parsed?.endDate) {
    return { period: parsed, source: "question", warnings: [] };
  }

  const hours = filters.timeRangeHours ?? 24;
  const rangeId = filters.selectedRange ?? null;
  if (hours === MONTH_HOURS || rangeId === "month") {
    return filterMtdPeriod();
  }

  if (supabase) {
    const scopedBranch = resolveRbacQueryBranch(profile, branch);
    try {
      const batch = await getLatestBatchByType(DEFAULT_IMPORT_TYPE, scopedBranch, profile);
      const fromBatch = latestBatchPeriod(batch);
      if (fromBatch) return fromBatch;
    } catch {
      // Fall through — caller may surface missing period.
    }
  }

  return { period: null, source: null, warnings: [] };
}

export { monthBounds, DEFAULT_IMPORT_TYPE };
