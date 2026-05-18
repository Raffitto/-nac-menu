import React, { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { computeReviewKpis } from "../utils/reviewEventMetrics";
import { rangeToSince } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import SnapshotShareCard from "../components/SnapshotShareCard";

export default function ReviewSnapshotPanel() {
  const filters = usePlatformFiltersOptional();
  const [kpis, setKpis] = useState(null);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured()) return;
    let cancelled = false;
    (async () => {
      const since = rangeToSince(filters?.selectedRange || "7d");
      let q = supabase
        .from("review_events")
        .select("event_type,created_at,branch_id,employee_role,language")
        .limit(5000);
      if (since) q = q.gte("created_at", since);
      if (filters?.branch) q = q.eq("branch_id", filters.branch);
      const { data } = await q;
      if (!cancelled) setKpis(computeReviewKpis(applyPlatformFilters(data || [], filters)));
    })();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const metrics = [
    { label: "QR scans", value: String(kpis?.qr_scans ?? "—") },
    { label: "Google clicks", value: String(kpis?.google_redirects ?? "—") },
    { label: "Conversion", value: `${kpis?.conversion_pct ?? "—"}%` },
    { label: "Generated", value: String(kpis?.reviews_generated ?? "—") },
  ];

  return (
    <SnapshotShareCard
      title="Review performance"
      branch={filters?.branch}
      range={filters?.selectedRange || "7d"}
      metrics={metrics}
      highlight={
        kpis?.conversion_pct != null
          ? `${kpis.conversion_pct}% scan-to-Google conversion this period`
          : undefined
      }
    />
  );
}
