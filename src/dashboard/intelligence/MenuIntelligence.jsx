import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { CATEGORY_NAMES } from "../utils/formatters";
import { useMenuBiDashboard } from "../hooks/useMenuBiDashboard";
import BiLiveFallbackBanner from "../components/BiLiveFallbackBanner";
import {
  isBiAddonsEmpty,
  isBiCategoriesEmpty,
  isBiTopItemsEmpty,
} from "../../lib/biDashboardNormalize";

const TOOLTIP = {
  background: "rgba(8,10,12,0.94)",
  border: "1px solid rgba(215,188,138,0.35)",
  borderRadius: 12,
  color: "#f9f9f7",
  fontSize: 12,
};

export default function MenuIntelligence() {
  const {
    data,
    loading,
    needsAuth,
    showFallbackBanner,
    menuDataEmpty,
  } = useMenuBiDashboard();

  const topItems = useMemo(() => (data?.top_items || []).slice(0, 10), [data?.top_items]);
  const bottomItems = useMemo(
    () => [...(data?.top_items || [])].sort((a, b) => a.opens - b.opens).slice(0, 5),
    [data?.top_items],
  );
  const topAddons = useMemo(() => (data?.top_addon_pairs || []).slice(0, 8), [data?.top_addon_pairs]);
  const topCategories = useMemo(
    () =>
      (data?.top_categories || []).map((c) => ({
        name: CATEGORY_NAMES[c.id] || c.id,
        opens: c.opens,
      })),
    [data?.top_categories],
  );

  const itemsEmpty = !loading && !menuDataEmpty && isBiTopItemsEmpty(data);
  const categoriesEmpty = !loading && !menuDataEmpty && isBiCategoriesEmpty(data);
  const addonsEmpty = !loading && !menuDataEmpty && isBiAddonsEmpty(data);

  if (loading) {
    return (
      <div style={{ display: "grid", gap: "1rem" }}>
        <div className="nac-bi-skeleton" style={{ height: 200, borderRadius: 18 }} />
        <motion.div className="nac-bi-skeleton" style={{ height: 200, borderRadius: 18 }} />
      </div>
    );
  }

  if (needsAuth) {
    return <p className="nac-empty-state">Sign in and refresh to load menu intelligence.</p>;
  }

  if (menuDataEmpty) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <BiLiveFallbackBanner visible={showFallbackBanner} />
        <p className="nac-empty-state">No menu activity in this period.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <BiLiveFallbackBanner visible={showFallbackBanner} />

      <div className="nac-glass-panel">
        <h3 style={{ margin: "0 0 1rem", fontWeight: 500 }}>Most viewed dishes</h3>
        {itemsEmpty ? (
          <p className="nac-empty-state">No item views yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topItems} layout="vertical" margin={{ left: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fill: "rgba(249,249,247,0.65)", fontSize: 10 }} />
              <Tooltip contentStyle={TOOLTIP} />
              <Bar dataKey="opens" fill="#d7bc8a" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        <div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", fontWeight: 500 }}>Category engagement</h3>
          {categoriesEmpty ? (
            <p className="nac-empty-state">No category opens yet</p>
          ) : (
            topCategories.map((c, i) => (
              <div key={c.name} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", fontSize: "0.85rem" }}>
                <span>
                  {i + 1}. {c.name}
                </span>
                <strong>{c.opens}</strong>
              </div>
            ))
          )}
        </div>

        <div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", fontWeight: 500 }}>Top add-ons</h3>
          {addonsEmpty ? (
            <p className="nac-empty-state">No add-on data</p>
          ) : (
            topAddons.map((row) => (
              <div key={`${row.item}-${row.addon}`} style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                <motion.div style={{ color: "#f9f9f7" }}>{row.item}</motion.div>
                <div style={{ color: "rgba(249,249,247,0.5)", fontSize: "0.75rem" }}>+ {row.addon} · {row.clicks} clicks</div>
              </div>
            ))
          )}
        </div>

        <div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", fontWeight: 500 }}>Lowest engagement</h3>
          {itemsEmpty ? (
            <p className="nac-empty-state">No item views yet</p>
          ) : (
            bottomItems.map((item) => (
              <div key={item.name} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.35rem 0" }}>
                <span>{item.name}</span>
                <span style={{ color: "#f5a623" }}>{item.opens} opens</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
