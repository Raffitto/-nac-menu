import React from "react";
import GoogleReputationBadge from "./GoogleReputationBadge";
import {
  formatGoogleMovementChip,
  formatGoogleMovementMonthChip,
} from "../utils/googleReviewSnapshotHistory";
import "../styles/google-reputation.css";

/**
 * Google rating + review count with snapshot-based movement chips.
 */
export default function GoogleReputationWithMovement({
  metrics,
  movement,
  loading = false,
  compact = false,
  showName = false,
  className = "",
}) {
  const todayChip = formatGoogleMovementChip(movement);
  const monthChip = formatGoogleMovementMonthChip(movement);

  return (
    <div className={`nac-google-rep-wrap ${className}`}>
      <GoogleReputationBadge
        metrics={metrics}
        loading={loading}
        compact={compact}
        showName={showName}
      />
      {!loading && movement?.tracking_start_date && (todayChip || monthChip) && (
        <div className="nac-google-movement-chips">
          {todayChip && (
            <span
              className={`nac-google-movement-chip ${movement.today_delta < 0 ? "nac-google-movement-chip--down" : ""}`}
              title="Google review count change vs previous snapshot"
            >
              Today {todayChip}
            </span>
          )}
          {monthChip && (
            <span
              className="nac-google-movement-chip nac-google-movement-chip--month"
              title={
                movement.month_partial
                  ? movement.history_note
                  : "Google reviews gained this month (snapshot-based)"
              }
            >
              {monthChip}
            </span>
          )}
        </div>
      )}
      {!loading && !movement?.tracking_start_date && (
        <span className="nac-google-movement-muted">No Google snapshot history yet</span>
      )}
    </div>
  );
}
