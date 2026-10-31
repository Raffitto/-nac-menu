import { formatVisitPct } from "../utils/reviewVisitMetrics";
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { branchDisplayName } from "../utils/rangeState";
import { useReviewIntelligenceData } from "../hooks/useReviewIntelligenceData";

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function TrendBadge({ current, previous }) {
  if (!previous) return <Minus size={14} style={{ opacity: 0.4 }} />;
  const delta = current - previous;
  if (delta > 0) return <TrendingUp size={14} color="#4ecdc4" />;
  if (delta < 0) return <TrendingDown size={14} color="#f5a623" />;
  return <Minus size={14} style={{ opacity: 0.4 }} />;
}

export default function EmployeePerformanceGrid() {
  const reviewData = useReviewIntelligenceData();
  const { staffMerged: staff, loading } = reviewData;
  const [sort, setSort] = useState("scans");

  const sorted = useMemo(() => {
    const list = [...staff];
    if (sort === "conversion") list.sort((a, b) => b.conversion_pct - a.conversion_pct);
    else if (sort === "google") list.sort((a, b) => b.google - a.google);
    else list.sort((a, b) => b.scans - a.scans);
    return list;
  }, [staff, sort]);

  const prevMap = useMemo(() => ({}), []);

  if (loading) {
    return (
      <div className="nac-emp-grid">
        {[1, 2, 3].map((i) => (
          <motion.div key={i} className="nac-bi-skeleton" style={{ height: 160, borderRadius: 18 }} />
        ))}
      </div>
    );
  }

  if (reviewData.error || reviewData.partial) {
    return <p role="alert" className="nac-empty-state">Complete Team totals are unavailable. {reviewData.error || "Please retry."}</p>;
  }

  if (sorted.length === 0) {
    return <p className="nac-empty-state">No staff-tagged review activity in this period.</p>;
  }

  return (
    <>
      <div className="nac-filter-row" style={{ marginBottom: "1rem" }}>
        <span className="nac-filter-pill-label">Sort by</span>
        {[
          { id: "scans", label: "Scans" },
          { id: "google", label: "Google clicks" },
          { id: "conversion", label: "Conversion" },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`nac-filter-range-btn ${sort === opt.id ? "active" : ""}`}
            onClick={() => setSort(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="nac-emp-grid">
        {sorted.map((emp, idx) => {
          const identity = `${emp.branch || "unknown"}::${String(emp.name).toLowerCase()}`;
          const prev = prevMap[identity];
          return (
            <motion.div
              key={identity}
              className="nac-emp-premium-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              whileHover={{ y: -3 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <div className="nac-emp-avatar">{initials(emp.name)}</div>
                  <div>
                    <strong style={{ fontSize: "1rem" }}>{emp.name}</strong>
                    <p style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", color: "rgba(249,249,247,0.5)" }}>
                      {emp.role || "Staff"} · {branchDisplayName(emp.branch || reviewData.branch)}
                    </p>
                  </div>
                </div>
                {idx === 0 && (
                  <span className="nac-emp-rank">
                    <Trophy size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                    #1
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "0.75rem",
                  marginTop: "1rem",
                }}
              >
                <motion.div>
                  <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>QR visits</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "1.25rem", fontWeight: 500 }}>
                    {emp.scans}
                    <TrendBadge current={emp.scans} previous={prev?.scans} />
                  </p>
                </motion.div>
                <motion.div>
                  <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Converted visits</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "1.25rem", fontWeight: 500 }}>
                    {emp.google}
                    <TrendBadge current={emp.google} previous={prev?.google} />
                  </p>
                </motion.div>
                <motion.div>
                  <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Visit conversion</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "1.25rem", fontWeight: 500 }}>
                    {formatVisitPct(emp.conversion_pct)}
                  </p>
                </motion.div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

