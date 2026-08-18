/**
 * Missing-evidence recovery using existing ingested sources only.
 * Does not invent mailbox or new acquisition infrastructure.
 */

import { formatManagerDate } from "./managementPresentation.ts";
import type { CommerceCoverage, CommerceStore } from "./commerce/semantic/execute.ts";
import type { DateRange } from "./types.ts";

export const CASH_UP_CHAT_ACQUISITION_BLOCKER =
  "Ask NAC cannot create a Cash Up workbook from chat. Cash Up is ingested only from an existing uploaded or Drive-synced file, and no queued Cash Up file for the requested date was available to ingest.";

export function commerceCoversPeriod(
  coverage: CommerceCoverage | null | undefined,
  period: DateRange | null,
): boolean {
  if (!coverage?.endDate || !period?.startDate || !period.endDate) return false;
  const start = coverage.startDate || coverage.endDate;
  return start <= period.endDate && coverage.endDate >= period.startDate;
}

export function formatProvisionalCommerceAnswer(input: {
  period: DateRange | null;
  cashUpMissing: boolean;
  latestCashUp?: string | null;
  netSales: number | null;
  covers?: number | null;
  acquisitionBlocker?: string | null;
}): string {
  const day = input.period
    ? (input.period.startDate === input.period.endDate
      ? formatManagerDate(input.period.startDate)
      : `${formatManagerDate(input.period.startDate)}–${formatManagerDate(input.period.endDate)}`)
    : "the requested day";
  const parts: string[] = [];
  if (input.acquisitionBlocker) parts.push(input.acquisitionBlocker);
  if (input.cashUpMissing) {
    let miss = `Authoritative Cash Up headline sales for ${day} are not available.`;
    if (input.latestCashUp) miss += ` Latest completed Cash Up is ${formatManagerDate(input.latestCashUp)}.`;
    parts.push(miss);
  }
  if (input.netSales != null && Number.isFinite(input.netSales)) {
    parts.push(
      `Foodics commerce can provide a provisional check-total view (not Cash Up, not headline sales): SAR ${Math.round(input.netSales).toLocaleString("en-US")} for ${day}.`,
    );
    if (input.covers != null && Number.isFinite(input.covers)) {
      parts.push(`Provisional commerce covers: ${Math.round(input.covers).toLocaleString("en-US")}.`);
    }
  } else if (!input.acquisitionBlocker) {
    parts.push("No alternative ingested evidence was available for a provisional check-total.");
  }
  return parts.join(" ");
}

export async function sumCommercePeriod(
  store: CommerceStore | null | undefined,
  branchId: string | null,
  period: DateRange | null,
): Promise<{ netSales: number | null; covers: number | null; orderCount: number }> {
  if (!store || !branchId || !period?.startDate || !period.endDate) {
    return { netSales: null, covers: null, orderCount: 0 };
  }
  const orders = await store.fetchOrders({
    branchId,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  if (!orders.length) return { netSales: null, covers: null, orderCount: 0 };
  let net = 0;
  let covers = 0;
  for (const order of orders) {
    net += Number(order.net_sales || 0);
    covers += Number(order.covers || 0);
  }
  return { netSales: net, covers, orderCount: orders.length };
}
