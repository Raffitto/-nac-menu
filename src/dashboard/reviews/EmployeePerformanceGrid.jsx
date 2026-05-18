import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { aggregateStaffReviewStats } from "../utils/staffReviewStats";
import { branchDisplayName, rangeToSince } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { applyPlatformFilters } from "../utils/platformFilterApply";

const SELECT = "event_type,employee_name,employee_role,branch_id,created_at";

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
  const filters = usePlatformFiltersOptional();
  const [staff, setStaff] = useState([]);
  const [prevStaff, setPrevStaff] = useState([]);
  const [sort, setSort] = useState("scans");
  const [loading, setLoading] = useState(true);

  const branch = filters?.branch || null;

  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const since = rangeToSince(filters?.selectedRange || "today");
        let q = supabase
          .from("review_events")
          .select(SELECT)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (branch) q = q.eq("branch_id", branch);
        if (since) q = q.gte("created_at", since);

        const { data: raw } = await q;
        const data = applyPlatformFilters(raw || [], filters);
        if (cancelled) return;

        const prevSince = new Date(since);
        const windowMs = Date.now() - prevSince.getTime();
        const prevStart = new Date(prevSince.getTime() - windowMs).toISOString();

        let pq = supabase
          .from("review_events")
          .select(SELECT)
          .gte("created_at", prevStart)
          .lt("created_at", since)
          .limit(3000);
        if (branch) pq = pq.eq("branch_id", branch);
        const { data: prevRaw } = await pq;
        const prevData = applyPlatformFilters(prevRaw || [], filters);

        setStaff(aggregateStaffReviewStats(data));
        setPrevStaff(aggregateStaffReviewStats(prevData));
      } catch {
        setStaff([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [branch, filters]);

  const sorted = useMemo(() => {
    const list = [...staff];
    if (sort === "conversion") list.sort((a, b) => b.conversion_pct - a.conversion_pct);
    else if (sort === "google") list.sort((a, b) => b.google - a.google);
    else list.sort((a, b) => b.scans - a.scans);
    return list;
  }, [staff, sort]);

  const prevMap = useMemo(() => {
    const m = {};
    prevStaff.forEach((s) => {
      m[s.name] = s;
    });
    return m;
  }, [prevStaff]);

  if (loading) {
    return (
      <div className="nac-emp-grid">
        {[1, 2, 3].map((i) => (
          <motion.div key={i} className="nac-bi-skeleton" style={{ height: 160, borderRadius: 18 }} />
        ))}
      </div>
    );
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
          const prev = prevMap[emp.name];
          return (
            <motion.div
              key={emp.name}
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
                      {emp.role || "Staff"} · {branchDisplayName(emp.branch || branch)}
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
                  <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Scans</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "1.25rem", fontWeight: 500 }}>
                    {emp.scans}
                    <TrendBadge current={emp.scans} previous={prev?.scans} />
                  </p>
                </motion.div>
                <motion.div>
                  <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Google</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "1.25rem", fontWeight: 500 }}>
                    {emp.google}
                    <TrendBadge current={emp.google} previous={prev?.google} />
                  </p>
                </motion.div>
                <motion.div>
                  <p style={{ margin: 0, fontSize: "0.65rem", color: "rgba(249,249,247,0.45)" }}>Conversion</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "1.25rem", fontWeight: 500 }}>
                    {emp.conversion_pct}%
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

