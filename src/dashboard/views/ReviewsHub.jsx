import React, { useState } from "react";
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
import "../styles/platform-os.css";

export default function ReviewsHub() {
  const [tab, setTab] = useState("performance");

  const openLeaderboard = () => {
    window.open(`${window.location.origin}/leaderboard`, "_blank", "noopener,noreferrer");
  };

  return (
    <GooglePlacesProvider>
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

      <GlobalFilterBar variant="extended" />

      <HubTabs tabs={REVIEWS_TABS} active={tab} onChange={setTab} />

      {tab === "performance" && <ReviewPerformanceSection />}
      {tab === "live" && <LiveActivityFeed />}
      {tab === "team" && <EmployeePerformanceGrid />}
      {tab === "branches" && <BranchBattle />}
    </motion.div>
    </GooglePlacesProvider>
  );
}
