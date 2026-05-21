import React, { useEffect, useState, forwardRef } from "react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { computeReviewKpis } from "../utils/reviewEventMetrics";
import { rangeToSince } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import SnapshotShareCard from "../components/SnapshotShareCard";
import ReviewExportBar from "./ReviewExportBar";
import { REVIEW_FUNNEL_SUBTITLE, REVIEW_METRIC } from "../config/reviewMetricLabels";

const ReviewSnapshotPanel = forwardRef(function ReviewSnapshotPanel(_props, snapshotRef) {
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

  const conv = kpis?.conversion_pct;
  const convAccent = conv == null ? null : conv >= 70 ? "teal" : conv >= 40 ? "gold" : "risk";

  const metrics = [
    { label: REVIEW_METRIC.cardTaps, value: String(kpis?.qr_scans ?? "—") },
    { label: REVIEW_METRIC.reviewInteractions, value: String(kpis?.reviews_generated ?? "—") },
    { label: REVIEW_METRIC.googleRedirects, value: String(kpis?.google_redirects ?? "—"), accent: "gold" },
    {
      label: REVIEW_METRIC.tapToGooglePct,
      value: `${conv ?? "—"}%`,
      accent: convAccent,
    },
  ];

  return (
    <section className="rev-export-panel">
      <ReviewExportBar snapshotRef={snapshotRef} />
      <SnapshotShareCard
        ref={snapshotRef}
        showActions={false}
        title="Review performance"
        branch={filters?.branch}
        range={filters?.selectedRange || "7d"}
        metrics={metrics}
        highlight={
          kpis
            ? `${REVIEW_FUNNEL_SUBTITLE}. ${kpis.qr_scans ?? 0} card taps · ${kpis.reviews_generated ?? 0} review interactions · ${kpis.google_redirects ?? 0} Google redirects.`
            : undefined
        }
      />
    </section>
  );
});

export default ReviewSnapshotPanel;
