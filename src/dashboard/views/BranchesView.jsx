import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Store, Crown } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import {
  fetchBranchComparisonSafe,
  fetchReviewEventsSummary,
} from "../../lib/intelligenceQueryApi";
import { branchComparisonFromReviewSummary } from "../utils/reviewSummaryMap";
import { branchDisplayName, rangeToHours } from "../utils/rangeState";
import { normalizeBranchId } from "../utils/branchIdentity";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import "../styles/platform-os.css";
import { useGooglePlaceMetrics } from "../hooks/useGooglePlaceMetrics";
import GoogleReputationBadge from "../components/GoogleReputationBadge";

const BRANCHES = ["khobar", "riyadh", "jeddah"];

export default function BranchesView() {
  const filters = usePlatformFiltersOptional();
  const [rows, setRows] = useState([]);
  const [menuByBranch, setMenuByBranch] = useState({});
  const [loading, setLoading] = useState(true);
  const { loading: googleLoading, byBranch: googleByBranch } = useGooglePlaceMetrics(null);

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const hours = rangeToHours(filters?.selectedRange || "today");
        const [reviewSummary, branchCmp] = await Promise.all([
          fetchReviewEventsSummary(supabase, { branch: null, hours }),
          fetchBranchComparisonSafe(supabase, hours),
        ]);

        const menuStats = {};
        (branchCmp.data || []).forEach((row) => {
          const b = normalizeBranchId(row.branch_id);
          if (!b) return;
          menuStats[b] = {
            sessions: Number(row.sessions) || 0,
            events: Number(row.impressions) + Number(row.opens) || 0,
          };
        });

        if (!cancelled) {
          setRows(branchComparisonFromReviewSummary(reviewSummary));
          setMenuByBranch(menuStats);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setMenuByBranch({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters?.selectedRange]);

  const leader = [...rows].sort((a, b) => b.qr_scans - a.qr_scans)[0]?.branch_id;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="nac-platform-header">
        <p className="nac-platform-kicker">NAC Network</p>
        <h1>Branches</h1>
        <p className="nac-platform-sub">Khobar · Riyadh · Jeddah performance snapshot</p>
      </header>

      {loading ? (
        <div className="nac-branch-battle-grid">
          {BRANCHES.map((b) => (
            <div key={b} className="nac-bi-skeleton" style={{ height: 160, borderRadius: 18 }} />
          ))}
        </div>
      ) : (
        <div className="nac-branch-battle-grid">
          {BRANCHES.map((id, i) => {
            const rev = rows.find((r) => r.branch_id === id) || { qr_scans: 0, conversion_pct: 0, google_redirects: 0 };
            const menu = menuByBranch[id] || { sessions: 0, events: 0 };
            const isLeader = id === leader && rev.qr_scans > 0;
            return (
              <motion.div
                key={id}
                className={`nac-branch-battle-card ${isLeader ? "leader" : ""}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                {isLeader && <Crown size={18} className="nac-branch-crown" />}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.5rem" }}>
                  <Store size={18} color="#d7bc8a" />
                  <h3 style={{ margin: 0, fontWeight: 500 }}>{branchDisplayName(id)}</h3>
                </div>
                <div className="nac-branch-google-rep">
                  <GoogleReputationBadge
                    metrics={googleByBranch[id]}
                    loading={googleLoading}
                    compact
                  />
                </div>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(249,249,247,0.5)" }}>
                  {menu.sessions} menu sessions · {menu.events} events (7D)
                </p>
                <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.65rem", opacity: 0.5 }}>Review scans</p>
                    <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 500 }}>{rev.qr_scans}</p>
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: "0.65rem", opacity: 0.5 }}>Conversion</p>
                    <p style={{ margin: 0, fontSize: "1.4rem", fontWeight: 500 }}>{rev.conversion_pct}%</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
