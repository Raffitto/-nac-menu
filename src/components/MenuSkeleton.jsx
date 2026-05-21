import React from "react";
import { motion } from "framer-motion";

const CARD_COUNT = 4;
const SECTION_COUNT = 2;

function SkeletonCard() {
  return (
    <div className="menu-skeleton-card" aria-hidden>
      <div className="menu-skeleton-card-media" />
      <div className="menu-skeleton-card-body">
        <div className="menu-skeleton-line menu-skeleton-line-title" />
        <div className="menu-skeleton-line menu-skeleton-line-desc" />
        <div className="menu-skeleton-card-meta">
          <div className="menu-skeleton-line menu-skeleton-line-meta" />
          <div className="menu-skeleton-line menu-skeleton-line-price" />
        </div>
      </div>
    </div>
  );
}

function SkeletonSection({ index }) {
  return (
    <section className="menu-section contextual-menu-section menu-skeleton-section">
      <div className="menu-skeleton-section-title" />
      <div className="menu-grid menu-grid-compact">
        {Array.from({ length: CARD_COUNT }, (_, i) => (
          <SkeletonCard key={`${index}-${i}`} />
        ))}
      </div>
    </section>
  );
}

export default function MenuSkeleton({ isArabic }) {
  return (
    <motion.div
      className="contextual-menu menu-skeleton"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
      aria-busy="true"
      aria-label={isArabic ? "جاري تحميل القائمة" : "Loading menu"}
    >
      <div className="contextual-nav-stack">
        <div className="contextual-menu-bar contextual-menu-bar-primary">
          {[72, 88, 64].map((w, i) => (
            <div
              key={i}
              className="menu-skeleton-pill"
              style={{ width: `${w}px` }}
            />
          ))}
        </div>
        <div className="section-nav contextual-section-nav-secondary menu-skeleton-section-nav">
          {[56, 72, 48, 64].map((w, i) => (
            <div
              key={i}
              className="menu-skeleton-pill menu-skeleton-pill-sm"
              style={{ width: `${w}px` }}
            />
          ))}
        </div>
      </div>

      <div className="contextual-category-block">
        <div className="contextual-category-head">
          <div className="menu-skeleton-line menu-skeleton-line-heading" />
          <div className="menu-skeleton-line menu-skeleton-line-time" />
        </div>

        <div className="contextual-menu-panel">
          {Array.from({ length: SECTION_COUNT }, (_, i) => (
            <SkeletonSection key={i} index={i} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
