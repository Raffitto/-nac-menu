import type { ExportRequestRecord } from "./exportRequests.ts";

export type FoodicsExportEmailMeta = {
  sender?: string | null;
  subject?: string | null;
  exportType?: string | null;
  branchName?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  exportReference?: string | null;
  receivedAt?: string | null;
};

export type MatchResult =
  | { status: "matched"; requestId: string; score: number }
  | { status: "unmatched"; reason: string };

const EXPORT_SUBJECT = /foodics|export|orders? items?|order items|orders\b/i;
const EXPORT_SENDER = /foodics/i;

export function isRelevantExportEmail(meta: FoodicsExportEmailMeta): boolean {
  const blob = `${meta.sender || ""} ${meta.subject || ""} ${meta.exportType || ""}`;
  return EXPORT_SUBJECT.test(blob) || EXPORT_SENDER.test(blob);
}

function datesEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return String(a).slice(0, 10) === String(b).slice(0, 10);
}

function datasetAlias(value: string | null | undefined): string {
  const v = String(value || "").toLowerCase();
  if (/order items|orders? items/.test(v)) return "order_items";
  if (/^orders?$/.test(v.trim()) || v.includes("orders")) return "orders";
  if (/sales by creator/.test(v)) return "sales_by_creator";
  if (/menu engineering/.test(v)) return "menu_engineering";
  return v.replace(/\s+/g, "_");
}

function branchAlias(value: string | null | undefined): string {
  const v = String(value || "").toLowerCase();
  if (/khobar/.test(v)) return "khobar";
  if (/jeddah/.test(v)) return "jeddah";
  if (/riyadh/.test(v)) return "riyadh";
  return v;
}

/**
 * Match an export email to a pending request. Strongest key wins.
 * Unmatched emails must be quarantined — never canonicalized.
 */
export function matchAsyncExportEmail(
  pending: ExportRequestRecord[],
  email: FoodicsExportEmailMeta,
): MatchResult {
  if (!isRelevantExportEmail(email)) {
    return { status: "unmatched", reason: "not_export_email" };
  }
  const waiting = pending.filter((r) => r.status === "waiting_async_delivery" || r.status === "requested");
  if (!waiting.length) return { status: "unmatched", reason: "no_pending_requests" };

  let best: { request: ExportRequestRecord; score: number } | null = null;
  for (const request of waiting) {
    let score = 0;
    if (email.exportReference && request.sourceRequestId && email.exportReference === request.sourceRequestId) {
      score += 100;
    }
    if (datasetAlias(email.exportType) === request.dataset) score += 40;
    if (branchAlias(email.branchName) === request.branchId) score += 25;
    if (datesEqual(email.periodStart, request.periodStart)) score += 15;
    if (datesEqual(email.periodEnd, request.periodEnd)) score += 15;
    if (email.receivedAt && request.requestedAt) {
      const delta = Math.abs(Date.parse(email.receivedAt) - Date.parse(request.requestedAt));
      if (delta <= 36 * 3600 * 1000) score += 10;
    }
    if (!best || score > best.score) best = { request, score };
  }
  if (!best || best.score < 55) {
    return { status: "unmatched", reason: "insufficient_match_score" };
  }
  return { status: "matched", requestId: best.request.id, score: best.score };
}
