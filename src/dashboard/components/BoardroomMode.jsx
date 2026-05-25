import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import { getCompanyName } from "../../config/companyConfig";
import { isTenantFeatureEnabled } from "../../config/tenantConfig";
import "../styles/boardroom-mode.css";

const ROTATE_MS = 14_000;

function AnimatedMetric({ value, suffix = "" }) {
  const [display, setDisplay] = useState(0);
  const target = Math.round(Number(value) || 0);

  useEffect(() => {
    setDisplay(0);
    let frame;
    const start = performance.now();
    const dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(target * eased));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return (
    <span className="boardroom-metric">
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}

/**
 * Fullscreen executive presentation — reuses Executive Command Center package (no duplicate analytics).
 */
export default function BoardroomMode({ commandPackage: pkg, rangeLabel = "", onClose }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);

  const slides = useMemo(() => {
    if (!pkg) return [];
    const brief = pkg.dailyBrief || {};
    const momentum = pkg.momentum || {};
    const strongest = brief.strongest_branch || pkg.rankings?.[0]?.branch_name || "—";
    const weakest = brief.weakest_branch || pkg.rankings?.[pkg.rankings.length - 1]?.branch_name || "—";
    const heatRows = (pkg.heatmap?.rows || []).slice(0, 6);

    return [
      {
        id: "network",
        label: "Network score",
        metric: pkg.networkScore,
        sub: pkg.networkScoreBuilding ? "Building baseline" : rangeLabel,
      },
      {
        id: "pulse",
        label: "Operational pulse",
        text: pkg.pulse?.live_label || "Live network monitoring",
        sub: `${pkg.pulse?.total_redirects ?? 0} Google redirects this period`,
      },
      {
        id: "strongest",
        label: "Strongest branch",
        text: strongest,
        sub: brief.momentum_summary,
      },
      {
        id: "weakest",
        label: "Weakest branch",
        text: weakest,
        sub: brief.operational_concern,
      },
      {
        id: "momentum",
        label: "Review momentum",
        text: momentum.insufficient_data ? "Insufficient data" : momentum.momentum,
        sub: brief.network_review_growth,
      },
      {
        id: "staff",
        label: "Staff participation",
        metric: pkg.pulse?.active_staff_count ?? 0,
        sub: `${pkg.pulse?.active_staff_count ?? 0} active contributors network-wide`,
      },
      {
        id: "alerts",
        label: "Risk alerts",
        text: pkg.alerts?.length ? `${pkg.alerts.length} active signals` : "No active alerts",
        sub: pkg.alerts?.[0]?.text,
      },
      {
        id: "brief",
        label: "Executive brief",
        text: brief.recommended_focus || brief.coaching_focus || "Operational focus",
        sub: brief.top_performer_today ? `Top performer: ${brief.top_performer_today}` : null,
      },
      {
        id: "heatmap",
        label: "Branch heatmap",
        heatRows,
        sub: "Operational scores by location",
      },
    ];
  }, [pkg, rangeLabel]);

  const goNext = useCallback(() => {
    setSlideIndex((i) => (i + 1) % Math.max(slides.length, 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setSlideIndex((i) => (i - 1 + slides.length) % Math.max(slides.length, 1));
  }, [slides.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goNext, goPrev]);

  useEffect(() => {
    if (!autoRotate || slides.length < 2) return undefined;
    const t = setInterval(goNext, ROTATE_MS);
    return () => clearInterval(t);
  }, [autoRotate, goNext, slides.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!isTenantFeatureEnabled("boardroomMode") || !pkg || !slides.length) return null;

  const slide = slides[slideIndex];

  return (
    <div className="boardroom-root" role="dialog" aria-modal="true" aria-label="Boardroom mode">
      <div className="boardroom-inner">
        <div className="boardroom-top">
          <div>
            <p className="boardroom-kicker">{getCompanyName()} · Boardroom</p>
            <h1 className="boardroom-title">{slide.label}</h1>
          </div>
          <div className="boardroom-controls">
            <button
              type="button"
              className={`boardroom-btn ${autoRotate ? "boardroom-btn--active" : ""}`}
              onClick={() => setAutoRotate((v) => !v)}
            >
              {autoRotate ? "Auto-rotate on" : "Auto-rotate"}
            </button>
            <button type="button" className="boardroom-btn" onClick={goPrev}>
              Previous
            </button>
            <button type="button" className="boardroom-btn" onClick={goNext}>
              Next
            </button>
            <button type="button" className="boardroom-btn" onClick={onClose} aria-label="Exit boardroom mode">
              <X size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Exit
            </button>
          </div>
        </div>

        <div className="boardroom-stage">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="boardroom-slide-label">{slide.label}</p>
              {slide.metric != null ? (
                <AnimatedMetric value={slide.metric} suffix={slide.id === "network" ? "" : ""} />
              ) : (
                <p className="boardroom-metric" style={{ fontSize: "clamp(32px, 6vw, 72px)" }}>
                  {slide.text}
                </p>
              )}
              {slide.sub ? <p className="boardroom-sub">{slide.sub}</p> : null}
              {slide.heatRows?.length ? (
                <div className="boardroom-heat-grid">
                  {slide.heatRows.map((row) => (
                    <div key={row.branch_id} className="boardroom-heat-cell">
                      <span>{row.branch_name || row.branch_id}</span>
                      <strong>{row.operational_score ?? "—"}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="boardroom-progress" aria-hidden>
          {slides.map((s, i) => (
            <div key={s.id} className={`boardroom-dot ${i === slideIndex ? "boardroom-dot--active" : ""}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Launch control for Command Center */
export function BoardroomLaunchButton({ onLaunch, disabled }) {
  return (
    <button type="button" className="ecc-export-btn" disabled={disabled} onClick={onLaunch}>
      <Maximize2 size={14} />
      Boardroom
    </button>
  );
}
