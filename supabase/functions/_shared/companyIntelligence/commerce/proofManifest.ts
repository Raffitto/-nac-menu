import type { CommerceQuality } from "./quality.ts";
import { formatPct } from "./quality.ts";
import type { SalesReconciliation } from "./reconciliation.ts";

export type ProofManifest = {
  branch: string;
  businessDate: string;
  batchId: string;
  acquisitionMode: string;
  orders: number | null;
  orderItems: number | null;
  orderItemJoinPct: number | null;
  completedDineInSessions: number | null;
  covers: number | null;
  quality: CommerceQuality | null;
  validation: "PASS" | "FAIL";
  publishedThrough: string | null;
  cashUpReconciliation: {
    state: "available" | "unavailable" | "warning";
    cashUpValue: number | null;
    foodicsValue: number | null;
    delta: number | null;
    deltaPct: number | null;
  };
  rawEvidence: Array<{ path: string; checksum: string | null; bytes?: number | null }>;
  checksums: Record<string, string | null>;
  lineage: Record<string, unknown>;
};

export function buildProofManifest(input: Partial<ProofManifest> & { branch: string; businessDate: string; batchId: string }): ProofManifest {
  return {
    branch: input.branch,
    businessDate: input.businessDate,
    batchId: input.batchId,
    acquisitionMode: input.acquisitionMode || "authenticated_read_fallback",
    orders: input.orders ?? null,
    orderItems: input.orderItems ?? null,
    orderItemJoinPct: input.orderItemJoinPct ?? null,
    completedDineInSessions: input.completedDineInSessions ?? null,
    covers: input.covers ?? null,
    quality: input.quality || null,
    validation: input.validation || "PASS",
    publishedThrough: input.publishedThrough || input.businessDate,
    cashUpReconciliation: input.cashUpReconciliation || {
      state: "unavailable",
      cashUpValue: null,
      foodicsValue: null,
      delta: null,
      deltaPct: null,
    },
    rawEvidence: input.rawEvidence || [],
    checksums: input.checksums || {},
    lineage: input.lineage || { batchId: input.batchId },
  };
}

export function proofSummaryText(m: ProofManifest): string {
  const q = m.quality;
  const recon = m.cashUpReconciliation;
  return [
    `${m.branch} Commerce Sync`,
    `Business date: ${m.businessDate}`,
    "",
    "Acquisition:",
    m.acquisitionMode,
    "",
    "Orders:",
    String(m.orders ?? "n/a"),
    "",
    "Order Items:",
    String(m.orderItems ?? "n/a"),
    "",
    "Orders ↔ Items join:",
    formatPct(m.orderItemJoinPct),
    "",
    "Completed dine-in sessions:",
    String(m.completedDineInSessions ?? "n/a"),
    "",
    "Covers:",
    String(m.covers ?? "n/a"),
    "",
    "Product mapping:",
    `${formatPct(q?.productUuidMappingPct)} products`,
    `${formatPct(q?.itemRowMappingPct)} item rows`,
    `${formatPct(q?.revenueMappingPct)} revenue`,
    "",
    "Confidently classified sessions:",
    formatPct(q?.confidentlyClassifiedSessionPct),
    "",
    "Unclassified sessions:",
    formatPct(q?.unclassifiedSessionPct),
    "",
    "Validation:",
    m.validation,
    "",
    "Cash Up reconciliation:",
    recon.state,
    "Cash Up value:",
    recon.cashUpValue == null ? "n/a" : String(recon.cashUpValue),
    "Foodics value:",
    recon.foodicsValue == null ? "n/a" : String(recon.foodicsValue),
    "delta:",
    recon.delta == null ? "n/a" : String(recon.delta),
    "",
    "Published through:",
    m.publishedThrough || "n/a",
    "",
    "Batch:",
    m.batchId,
    "",
    "Raw evidence:",
    m.rawEvidence.map((r) => `${r.path} sha256=${r.checksum || "n/a"}`).join("\n") || "n/a",
    "",
    "Checksums:",
    Object.entries(m.checksums).map(([k, v]) => `${k}=${v || "n/a"}`).join("\n") || "n/a",
    "",
  ].join("\n");
}

export function reconciliationState(row: SalesReconciliation | null | undefined): ProofManifest["cashUpReconciliation"]["state"] {
  if (!row || row.coverage !== "both") return "unavailable";
  if (row.health === "warning") return "warning";
  return "available";
}
