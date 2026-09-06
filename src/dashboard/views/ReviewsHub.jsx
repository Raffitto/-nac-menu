import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Monitor } from "lucide-react";
import HubTabs from "../components/HubTabs";
import GlobalFilterBar from "../components/GlobalFilterBar";
import { REVIEWS_TABS } from "../navigation";
import LiveActivityFeed from "../reviews/LiveActivityFeed";
import EmployeePerformanceGrid from "../reviews/EmployeePerformanceGrid";
import BranchBattle from "../reviews/BranchBattle";
import ReviewPerformanceSection from "../reviews/ReviewPerformanceSection";
import { GooglePlacesProvider } from "../context/GooglePlacesContext";
import { useRbac } from "../context/RbacContext";
import {
  buildReviewBranchFilterOptions,
  reviewAllowedBranchIds,
} from "../config/rbac";
import "../styles/platform-os.css";

export default function ReviewsHub() {
  const [tab, setTab] = useState("performance");
  const rbac = useRbac();
  const visibleTabs = useMemo(
    () => REVIEWS_TABS.filter((t) => rbac.canAccessReviewsTab(t.id)),
    [rbac],
  );
  const profileEmail = rbac.profile?.email;
  const profileScope = rbac.profile?.branchScope;
  const profileAllBranches = rbac.profile?.allBranches;
  const reviewBranchIds = useMemo(
    () => reviewAllowedBranchIds(rbac.profile),
    // Identity fields only — a new profile object must not refetch Google Places.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileEmail, profileScope, profileAllBranches],
  );
  const reviewBranchOptions = useMemo(
    () => buildReviewBranchFilterOptions(rbac.profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profileEmail, profileScope, profileAllBranches],
  );

  useEffect(() => {
    if (!visibleTabs.length) return;
    if (!visibleTabs.some((t) => t.id === tab)) {
      setTab(visibleTabs[0].id);
    }
  }, [tab, visibleTabs]);

  const openLeaderboard = () => {
    window.open(`${window.location.origin}/leaderboard`, "_blank", "noopener,noreferrer");
  };

  return (
    <GooglePlacesProvider branchIds={reviewBranchIds}>
    <motion.div className="nac-reviews-hub" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="nac-platform-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <p className="nac-platform-kicker">NAC Reviews</p>
            <h1>Reviews</h1>
            <p className="nac-platform-sub">Staff performance, live activity, and branch competition</p>
          </div>
          <button type="button" className="nac-filter-action" onClick={openLeaderboard}>
            <Monitor size={16} />
            TV Leaderboard
          </button>
        </div>
      </header>

      <GlobalFilterBar variant="extended" branchOptions={reviewBranchOptions} />

      <HubTabs tabs={visibleTabs} active={tab} onChange={setTab} />

      {tab === "performance" && <ReviewPerformanceSection />}
      {tab === "live" && <LiveActivityFeed />}
      {tab === "team" && <EmployeePerformanceGrid />}
      {tab === "branches" && <BranchBattle />}
    </motion.div>
    </GooglePlacesProvider>
  );
}
