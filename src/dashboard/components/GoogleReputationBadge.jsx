import React, { useEffect, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import {
  formatGoogleRating,
  formatGoogleReviewCount,
} from "../services/googlePlacesService";
import "../styles/google-reputation.css";

/**
 * Public Google Maps rating for a branch (Places API — not OAuth).
 */
export default function GoogleReputationBadge({
  metrics,
  loading = false,
  compact = false,
  showName = false,
  className = "",
}) {
  const [loadingExpired, setLoadingExpired] = useState(false);
  useEffect(() => {
    if (!loading) {
      setLoadingExpired(false);
      return undefined;
    }
    const timer = setTimeout(() => setLoadingExpired(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading && !loadingExpired) {
    return (
      <div className={`nac-google-rep nac-google-rep--loading ${className}`} aria-busy="true">
        <Loader2 size={compact ? 12 : 14} className="nac-bi-spin" />
        <span>Loading Google rating…</span>
      </div>
    );
  }

  const rating = formatGoogleRating(metrics?.rating);
  const reviews = formatGoogleReviewCount(metrics?.totalReviews);

  if (!rating) {
    const reason = metrics?.error;
    const label = reason === "missing_place_id"
      ? "Not tracked"
      : reason === "no_snapshot"
        ? "No recent snapshot"
        : reason === "timed_out" || reason === "network" || reason === "fetch_failed"
          ? "Source delayed"
          : "Unavailable";
    return (
      <div className={`nac-google-rep nac-google-rep--muted ${className}`} title={label}>
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div className={`nac-google-rep ${compact ? "nac-google-rep--compact" : ""} ${className}`}>
      <span className="nac-google-rep-rating" aria-label={`Google rating ${rating}`}>
        <Star size={compact ? 12 : 14} fill="currentColor" aria-hidden />
        {rating}
      </span>
      <span className="nac-google-rep-count">{reviews}</span>
      {showName && metrics?.displayName && (
        <span className="nac-google-rep-name">{metrics.displayName}</span>
      )}
    </div>
  );
}
