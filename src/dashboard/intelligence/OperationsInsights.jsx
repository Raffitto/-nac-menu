import React, { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { generateInsights } from "../utils/insights";
import { buildRestaurantIntelligence } from "../engines/analyticsEngine";
import { getFoodicsIntelligenceContext } from "../../lib/foodicsApi";
import { useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import InsightEngine from "../components/InsightEngine";
import PlatformStatusBanner from "../components/PlatformStatusBanner";
import { useState, useEffect } from "react";

export default function OperationsInsights() {
  const { data: bi, loading, platformStatus } = useMenuBiDashboardContext();
  const [foodics, setFoodics] = useState(null);

  useEffect(() => {
    if (!bi) {
      setFoodics(null);
      return;
    }
    getFoodicsIntelligenceContext(bi)
      .then(setFoodics)
      .catch(() => setFoodics(null));
  }, [bi]);

  const insights = useMemo(() => generateInsights(bi), [bi]);

  const summaries = useMemo(() => {
    if (!bi) return [];
    const intel = buildRestaurantIntelligence(bi, foodics);
    const lines = [];
    const lang = bi?.by_language || {};
    const ar = Number(lang.ar) || 0;
    const en = Number(lang.en) || 0;
    if (ar + en > 0 && ar > en * 1.2) {
      lines.push("Arabic guests drive higher menu engagement in this period.");
    } else if (en > ar * 1.2) {
      lines.push("English sessions lead interaction volume — optimize EN item copy.");
    }
    if (bi?.strongest_hour != null) {
      const h = Number(bi.strongest_hour);
      const label = h > 12 ? `${h - 12} PM` : h === 12 ? "12 PM" : h === 0 ? "12 AM" : `${h} AM`;
      lines.push(`Peak activity clusters around ${label} service.`);
    }
    const top = (bi?.top_items || [])[0];
    if (top?.name) {
      lines.push(`${top.name} leads views — pair with high-margin add-ons at table.`);
    }
    const dead = (bi?.dead_zones || [])[0];
    if (dead?.category) {
      lines.push(`Category "${dead.category}" shows browse-without-click — review placement and photos.`);
    }
    if (intel?.friction?.[0]?.title) {
      lines.push(intel.friction[0].title);
    }
    return lines.slice(0, 5);
  }, [bi, foodics]);

  if (loading) {
    return <div className="nac-bi-skeleton" style={{ height: 240, borderRadius: 18 }} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <PlatformStatusBanner platformStatus={platformStatus} />
      <div className="nac-glass-panel">
        <h3 style={{ margin: "0 0 1rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
          <Sparkles size={18} color="#d7bc8a" />
          Operational correlations
        </h3>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "rgba(249,249,247,0.78)", lineHeight: 1.7 }}>
          {summaries.length === 0 ? (
            <li>Gather more sessions to unlock cross-signal insights.</li>
          ) : (
            summaries.map((s) => <li key={s}>{s}</li>)
          )}
        </ul>
      </div>
      {insights.length > 0 && <InsightEngine insights={insights} />}
    </div>
  );
}
