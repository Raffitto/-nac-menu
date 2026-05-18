import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, QrCode, Users } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { aggregateStaffReviewStats } from "./utils/staffReviewStats";
import { buildBranchReviewComparison } from "./utils/reviewEventMetrics";
import { branchDisplayName, rangeToSince } from "./utils/rangeState";
import LiveActivityFeed from "./reviews/LiveActivityFeed";
import { PlatformFiltersProvider } from "./context/PlatformFiltersContext";
import "./styles/platform-os.css";
import "./styles/leaderboard.css";

const SECTIONS = ["staff", "branches", "activity", "targets"];
const ROTATE_MS = 12000;

function LeaderboardInner() {
  const [section, setSection] = useState(0);
  const [staff, setStaff] = useState([]);
  const [branches, setBranches] = useState([]);

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) return;
    const since = rangeToSince("today");
    let q = supabase
      .from("review_events")
      .select("event_type,employee_name,employee_role,branch_id,created_at")
      .limit(5000);
    if (since) q = q.gte("created_at", since);
    const { data } = await q;
    setStaff(aggregateStaffReviewStats(data || []).slice(0, 8));
    setBranches(buildBranchReviewComparison(data || []));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const rot = setInterval(() => setSection((s) => (s + 1) % SECTIONS.length), ROTATE_MS);
    return () => clearInterval(rot);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") window.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const key = SECTIONS[section];

  return (
    <div className="nac-leaderboard">
      <header className="nac-leaderboard-header">
        <p className="nac-leaderboard-kicker">NAC HOSPITALITY OS</p>
        <h1>Live Leaderboard</h1>
        <p className="nac-leaderboard-hint">Press ESC to exit · Auto-rotating views</p>
      </header>

      <AnimatePresence mode="wait">
        {key === "staff" && (
          <motion.section
            key="staff"
            className="nac-leaderboard-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <h2>
              <Trophy size={28} /> Top team
            </h2>
            <motion.div className="nac-leaderboard-staff-grid">
              {staff.map((s, i) => (
                <motion.div key={s.name} className="nac-leaderboard-staff-card" layout>
                  <span className="nac-leaderboard-rank">#{i + 1}</span>
                  <strong>{s.name}</strong>
                  <p>{s.scans} scans · {s.conversion_pct}% conversion</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.section>
        )}

        {key === "branches" && (
          <motion.section
            key="branches"
            className="nac-leaderboard-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <h2>
              <Users size={28} /> Branch rankings
            </h2>
            <div className="nac-leaderboard-branch-row">
              {branches.map((b) => (
                <div key={b.branch_id} className="nac-leaderboard-branch-card">
                  <h3>{branchDisplayName(b.branch_id)}</h3>
                  <p className="nac-leaderboard-big">{b.qr_scans}</p>
                  <span>scans · {b.conversion_pct}% conv.</span>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {key === "activity" && (
          <motion.section
            key="activity"
            className="nac-leaderboard-section nac-leaderboard-activity"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <h2>
              <QrCode size={28} /> Latest activity
            </h2>
            <LiveActivityFeed maxItems={12} />
          </motion.section>
        )}

        {key === "targets" && (
          <motion.section
            key="targets"
            className="nac-leaderboard-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <h2>Daily targets</h2>
            <div className="nac-leaderboard-targets">
              <div className="nac-leaderboard-target-card">
                <p>Review scans today</p>
                <strong>{branches.reduce((a, b) => a + b.qr_scans, 0)}</strong>
              </div>
              <motion.div className="nac-leaderboard-target-card">
                <p>Google redirects</p>
                <strong>{branches.reduce((a, b) => a + b.google_redirects, 0)}</strong>
              </motion.div>
              <div className="nac-leaderboard-target-card">
                <p>Network conversion</p>
                <strong>
                  {branches.length
                    ? Math.round(
                        branches.reduce((a, b) => a + b.conversion_pct, 0) / branches.length,
                      )
                    : 0}
                  %
                </strong>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="nac-leaderboard-dots">
        {SECTIONS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={i === section ? "active" : ""}
            onClick={() => setSection(i)}
            aria-label={s}
          />
        ))}
      </div>
    </div>
  );
}

export default function LeaderboardView() {
  return (
    <PlatformFiltersProvider>
      <LeaderboardInner />
    </PlatformFiltersProvider>
  );
}
