import React, { forwardRef } from "react";
import SnapshotShareCard from "../components/SnapshotShareCard";
import ReviewExportBar from "./ReviewExportBar";
import { REVIEW_FUNNEL_SUBTITLE, REVIEW_METRIC } from "../config/reviewMetricLabels";
import { useReviewIntelligenceData } from "../hooks/useReviewIntelligenceData";

const ReviewSnapshotPanel = forwardRef(function ReviewSnapshotPanel(
  { prefetched = null },
  snapshotRef,
) {
  const ownData = useReviewIntelligenceData({ skip: Boolean(prefetched) });
  const data = prefetched || ownData;
  const kpis = data?.kpis;
  const filters = data?.branch != null ? { branch: data.branch, selectedRange: data.selectedRange } : null;

  const conv = kpis?.conversion_pct;
  const convAccent = conv == null ? null : conv >= 70 ? "teal" : conv >= 40 ? "gold" : "risk";

  const metrics = [
    { label: REVIEW_METRIC.cardTaps, value: String(kpis?.qr_scans ?? "-") },
    { label: REVIEW_METRIC.reviewInteractions, value: String(kpis?.reviews_generated ?? "-") },
    { label: REVIEW_METRIC.googleRedirects, value: String(kpis?.google_redirects ?? "-"), accent: "gold" },
    {
      label: REVIEW_METRIC.tapToGooglePct,
      value: `${conv ?? "-"}%`,
      accent: convAccent,
    },
  ];

  return (
    <section className="rev-export-panel">
      <ReviewExportBar snapshotRef={snapshotRef} reviewData={data} />
      <SnapshotShareCard
        ref={snapshotRef}
        showActions={false}
        title="Review performance"
        branch={filters?.branch ?? data?.branch}
        range={filters?.selectedRange ?? data?.selectedRange ?? "7d"}
        metrics={metrics}
        highlight={
          kpis
            ? `${REVIEW_FUNNEL_SUBTITLE}. ${kpis.qr_scans ?? 0} card taps | ${kpis.reviews_generated ?? 0} review interactions | ${kpis.google_redirects ?? 0} Google redirects.`
            : data?.loading
              ? "Loading review metrics..."
              : "No review activity in this period yet."
        }
        footer="NAC HOSPITALITY OS"
      />
    </section>
  );
});

export default ReviewSnapshotPanel;
