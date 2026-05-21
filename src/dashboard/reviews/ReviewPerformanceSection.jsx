import React, { Suspense, lazy, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { useReviewIntelligenceData } from "../hooks/useReviewIntelligenceData";
import ReviewSnapshotPanel from "./ReviewSnapshotPanel";

const ReviewIntelligence = lazy(() => import("../ReviewIntelligence"));

function ViewFallback({ label }) {
  return (
    <div
      className="nac-bi-loading"
      style={{
        minHeight: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <RefreshCw size={20} className="nac-bi-spin" />
      <span style={{ marginLeft: 8 }}>{label}</span>
    </div>
  );
}

/**
 * Performance tab — one shared review fetch for intelligence + snapshot card.
 */
export default function ReviewPerformanceSection() {
  const snapshotRef = useRef(null);
  const reviewData = useReviewIntelligenceData();

  return (
    <>
      <Suspense fallback={<ViewFallback label="Loading review performance…" />}>
        <ReviewIntelligence embedded prefetched={reviewData} />
      </Suspense>
      <ReviewSnapshotPanel ref={snapshotRef} prefetched={reviewData} />
    </>
  );
}
