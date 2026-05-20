import React from "react";
import { branchDisplayName } from "../utils/rangeState";
import { GOOGLE_PLACE_BRANCHES } from "../config/googleBranchPlaces";
import { useGooglePlaceMetrics } from "../hooks/useGooglePlaceMetrics";
import GoogleReputationBadge from "./GoogleReputationBadge";

/**
 * Executive row — Google reputation for all branches.
 */
export default function GoogleReputationStrip({ title = "Google reputation (public)" }) {
  const { loading, byBranch, error } = useGooglePlaceMetrics(null);

  return (
    <section className="nac-google-rep-strip" aria-label={title}>
      <p className="nac-google-rep-strip-title">{title}</p>
      <div className="nac-google-rep-strip-grid">
        {GOOGLE_PLACE_BRANCHES.map((branchId) => (
          <div key={branchId} className="nac-google-rep-strip-card">
            <span className="nac-google-rep-strip-branch">{branchDisplayName(branchId)}</span>
            <GoogleReputationBadge
              metrics={byBranch[branchId]}
              loading={loading}
              compact
            />
          </div>
        ))}
      </div>
      {!loading && error === "missing_api_key" && (
        <p className="nac-google-rep-strip-hint">Set REACT_APP_GOOGLE_API_KEY to load public ratings.</p>
      )}
    </section>
  );
}
