import type { PublishedCommerce } from "./synthesis.ts";
import type { MixComparison, ServiceMixResult } from "./types.ts";
import type { EvidenceSummary } from "./lineage.ts";
import type { CommerceQuality } from "./quality.ts";
import { reconcileHeadlineSales } from "./reconciliation.ts";

type SnapshotRow = {
  mix: ServiceMixResult;
  comparison?: MixComparison | null;
  item_mix?: PublishedCommerce["itemMix"];
  evidence_summary?: EvidenceSummary | null;
  mapping_quality?: {
    unclassifiedRate?: number;
    productUuidMappingPct?: number;
    itemRowMappingPct?: number;
    revenueMappingPct?: number;
    confidentlyClassifiedSessionPct?: number;
    unclassifiedSessionPct?: number;
    orderItemJoinPct?: number;
  } | null;
  lineage?: Record<string, unknown> | null;
  period_start: string;
  period_end: string;
  status: string;
};

export async function loadPublishedCommerce(
  supabase: { from: (t: string) => any },
  branchId: string | null,
): Promise<PublishedCommerce | null> {
  if (!branchId) return null;
  const { data, error } = await supabase
    .from("commerce_published_snapshots")
    .select("mix,comparison,item_mix,evidence_summary,mapping_quality,lineage,period_start,period_end,status")
    .eq("branch_id", branchId)
    .eq("status", "published")
    .order("period_end", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as SnapshotRow;
  if (!row.mix || !row.mix.totalSessions) return null;
  const { data: freshness } = await supabase
    .from("commerce_dataset_freshness")
    .select("dataset,status,data_through,last_success_at,quality")
    .eq("branch_id", branchId);
  const byDs = Object.fromEntries((freshness || []).map((r: { dataset: string }) => [r.dataset, r]));
  const mq = row.mapping_quality || {};
  const quality: CommerceQuality = {
    productUuidMappingPct: mq.productUuidMappingPct ?? null,
    itemRowMappingPct: mq.itemRowMappingPct ?? null,
    revenueMappingPct: mq.revenueMappingPct ?? null,
    confidentlyClassifiedSessionPct: mq.confidentlyClassifiedSessionPct
      ?? (mq.unclassifiedRate != null ? 1 - Number(mq.unclassifiedRate) : null),
    unclassifiedSessionPct: mq.unclassifiedSessionPct ?? (mq.unclassifiedRate != null ? Number(mq.unclassifiedRate) : null),
    orderItemJoinPct: mq.orderItemJoinPct ?? null,
  };
  const evidence = {
    ...(row.evidence_summary || {}),
    quality: row.evidence_summary?.quality || quality,
    salesSource: row.evidence_summary?.salesSource || "Cash Up",
    sessionSource: row.evidence_summary?.sessionSource || "canonical commerce sessions",
  };
  const { data: recon } = await supabase
    .from("commerce_reconciliation")
    .select("branch_id,business_date,cash_up_sales,foodics_sales,absolute_difference,percentage_difference")
    .eq("branch_id", branchId)
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    mix: row.mix,
    comparison: row.comparison || null,
    itemMix: row.item_mix || [],
    evidence,
    health: {
      dataThrough: row.mix.completedThrough || row.period_end,
      lastIngestAt: row.mix.lastIngestAt,
      status: byDs.commerce_sessions?.status || "ready",
      ordersStatus: byDs.orders?.status || "unknown",
      itemsStatus: byDs.order_items?.status || "unknown",
      publicationStatus: row.status,
      mappingQuality: quality.confidentlyClassifiedSessionPct,
      quality,
      error: null,
    },
    reconciliation: recon
      ? reconcileHeadlineSales({
        branchId: recon.branch_id,
        businessDate: String(recon.business_date).slice(0, 10),
        cashUpSales: recon.cash_up_sales == null ? null : Number(recon.cash_up_sales),
        foodicsSales: recon.foodics_sales == null ? null : Number(recon.foodics_sales),
      })
      : null,
  };
}
