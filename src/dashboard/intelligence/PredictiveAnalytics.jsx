import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { computeReviewKpis } from "../utils/reviewEventMetrics";
import { rangeToSince } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";

function ProgressRing({ pct, label, sub }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={110} height={110} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={55} cy={55} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={8} />
        <motion.circle
          cx={55}
          cy={55}
          r={r}
          fill="none"
          stroke="#d7bc8a"
          strokeWidth={8}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1 }}
        />
      </svg>
      <p style={{ margin: "0.5rem 0 0", fontSize: "1.5rem", fontWeight: 500 }}>{pct}%</p>
      <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(249,249,247,0.55)" }}>{label}</p>
      {sub && <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "rgba(249,249,247,0.4)" }}>{sub}</p>}
    </div>
  );
}

export default function PredictiveAnalytics() {
  const filters = usePlatformFiltersOptional();
  const [kpis, setKpis] = useState(null);

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured()) return;
    let cancelled = false;
    (async () => {
      const since = rangeToSince(filters?.selectedRange || "7d");
      let q = supabase.from("review_events").select("event_type,created_at,branch_id").limit(5000);
      if (since) q = q.gte("created_at", since);
      if (filters?.branch) q = q.eq("branch_id", filters.branch);
      const { data } = await q;
      if (!cancelled) setKpis(computeReviewKpis(data || []));
    })();
    return () => {
      cancelled = true;
    };
  }, [filters?.selectedRange, filters?.branch]);

  const forecast = useMemo(() => {
    const scans = kpis?.qr_scans || 0;
    const conv = kpis?.conversion_pct || 0;
    const projectedMonthly = Math.round(scans * 4.2);
    const targetRating = 4.8;
    const daysToTarget = conv > 0 ? Math.max(14, Math.round(120 / conv)) : 45;
    return { projectedMonthly, targetRating, daysToTarget, pace: Math.min(conv + 12, 95) };
  }, [kpis]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.25rem" }}>
      <motion.div className="nac-glass-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <ProgressRing pct={forecast.pace} label="Target pace" sub="Review conversion trajectory" />
      </motion.div>
      <motion.div className="nac-glass-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Projected monthly scans</p>
        <p style={{ margin: "0.35rem 0", fontSize: "2rem", fontWeight: 500 }}>{forecast.projectedMonthly}</p>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#4ecdc4" }}>↑ Based on current period velocity</p>
      </motion.div>
      <motion.div className="nac-glass-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <p style={{ margin: 0, fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>Est. days to {forecast.targetRating}★ momentum</p>
        <p style={{ margin: "0.35rem 0", fontSize: "2rem", fontWeight: 500 }}>{forecast.daysToTarget}</p>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(249,249,247,0.45)" }}>Assumes steady Google follow-through</p>
      </motion.div>
    </div>
  );
}
