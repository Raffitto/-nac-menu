export type PublicationStatus =
  | "requested"
  | "orders_received"
  | "items_received"
  | "waiting_for_companion"
  | "both_received"
  | "validated"
  | "canonicalized"
  | "quality_passed"
  | "published"
  | "quarantined";

export type PublicationGroup = {
  id: string;
  groupName: "commerce_sessions";
  branchId: string;
  periodStart: string;
  periodEnd: string;
  status: PublicationStatus;
  ordersBatchId: string | null;
  itemsBatchId: string | null;
};

export const PUBLICATION_THRESHOLDS = {
  minJoinRate: 0.98,
  maxDuplicateRate: 0,
  maxUnclassifiedSessionRate: 0.35,
  maxUnclassifiedRevenueRate: 0.35,
};

export function applyPublicationEvent(
  group: PublicationGroup,
  event: "orders_received" | "items_received" | "validated" | "canonicalized" | "quality_passed" | "published" | "quarantined",
): PublicationGroup {
  const next = { ...group };
  if (event === "orders_received") next.ordersBatchId = next.ordersBatchId || "received";
  if (event === "items_received") next.itemsBatchId = next.itemsBatchId || "received";
  const haveOrders = Boolean(next.ordersBatchId);
  const haveItems = Boolean(next.itemsBatchId);
  if (event === "quarantined") {
    next.status = "quarantined";
    return next;
  }
  if (haveOrders && haveItems) next.status = "both_received";
  else if (haveOrders && !haveItems) next.status = "waiting_for_companion";
  else if (haveItems && !haveOrders) next.status = "waiting_for_companion";
  if (haveOrders && haveItems) {
    if (event === "validated") next.status = "validated";
    if (event === "canonicalized") next.status = "canonicalized";
    if (event === "quality_passed") next.status = "quality_passed";
    if (event === "published") next.status = "published";
  }
  return next;
}

export function canPublishSessions(group: PublicationGroup): boolean {
  return Boolean(group.ordersBatchId && group.itemsBatchId)
    && (group.status === "quality_passed" || group.status === "published");
}

export function evaluatePublicationQuality(input: {
  joinRate: number;
  duplicateRate: number;
  schemaValid: boolean;
  unclassifiedSessionRate: number | null;
}): { ok: boolean; sessionMixReady: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.schemaValid) errors.push("schema_invalid");
  if (input.joinRate < PUBLICATION_THRESHOLDS.minJoinRate) errors.push("join_rate");
  if (input.duplicateRate > PUBLICATION_THRESHOLDS.maxDuplicateRate) errors.push("duplicate_rate");
  const sessionMixReady = errors.length === 0
    && (input.unclassifiedSessionRate == null
      || input.unclassifiedSessionRate < PUBLICATION_THRESHOLDS.maxUnclassifiedSessionRate);
  return { ok: errors.length === 0, sessionMixReady, errors };
}
