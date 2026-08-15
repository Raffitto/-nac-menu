import type { PublishedCommerce } from "./synthesis.ts";
import type { MixComparison, ServiceMixResult } from "./types.ts";
import type { EvidenceSummary } from "./lineage.ts";

type SnapshotRow = {
  mix: ServiceMixResult;
  comparison?: MixComparison | null;
  item_mix?: PublishedCommerce["itemMix"];
  evidence_summary?: EvidenceSummary | null;
  mapping_quality?: { unclassifiedRate?: number } | null;
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
  return {
    mix: row.mix,
    comparison: row.comparison || null,
    itemMix: row.item_mix || [],
    evidence: row.evidence_summary || null,
    health: {
      dataThrough: row.mix.completedThrough || row.period_end,
      lastIngestAt: row.mix.lastIngestAt,
      status: byDs.commerce_sessions?.status || "ready",
      ordersStatus: byDs.orders?.status || "unknown",
      itemsStatus: byDs.order_items?.status || "unknown",
      publicationStatus: row.status,
      mappingQuality: row.mapping_quality?.unclassifiedRate != null
        ? 1 - Number(row.mapping_quality.unclassifiedRate)
        : null,
      error: null,
    },
  };
}
