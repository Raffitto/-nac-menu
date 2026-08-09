import React from "react";
import { Swords } from "lucide-react";
import { useCompetitiveReputation } from "../hooks/useCompetitiveReputation";
import {
  formatGoogleRating,
  formatGoogleReviewCount,
} from "../services/googlePlacesService";
import "../styles/competitive-reputation.css";

/** Executive summary strip — full battlefield lives on Competitive Watch tab. */
export default function CompetitiveReputationTeaser() {
  const { loading, data, error } = useCompetitiveReputation(null);

  if (loading) {
    return (
      <section className="cr-teaser" aria-busy="true">
        <div className="nac-bi-skeleton" style={{ height: 88, borderRadius: 12 }} />
      </section>
    );
  }

  if (error) {
    return null;
  }

  return (
    <section className="cr-teaser">
      <div className="cr-teaser-head">
        <Swords size={16} />
        <h3>Competitive Reputation Watch</h3>
      </div>
      {data?.networkNarrative && <p className="cr-teaser-network">{data.networkNarrative}</p>}
      <div className="cr-teaser-branches">
        {(data?.branches || []).map((b) => {
          const rating = formatGoogleRating(b.nac?.rating);
          return (
            <div key={b.branchId} className="cr-teaser-branch">
              <strong>{b.branchLabel}</strong>
              <span>
                {rating ? `★ ${rating}` : "—"} · {formatGoogleReviewCount(b.nac?.totalReviews)}
              </span>
              <span className="cr-teaser-threat">
                {b.battlefield?.topThreatName} · {b.battlefield?.topThreatLevel}
              </span>
            </div>
          );
        })}
      </div>
      <p className="cr-teaser-link">Open Intelligence → Market → Competitors for full battlefield.</p>
    </section>
  );
}
