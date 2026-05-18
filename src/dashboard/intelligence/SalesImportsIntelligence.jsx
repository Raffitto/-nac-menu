import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Upload, TrendingUp, Users, AlertTriangle, ShoppingBag } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { getImportBatches, getBatchSalesItems, getLatestBatch } from "../../lib/foodicsApi";
import { normalizeTopItems } from "../utils/topItemsNormalize";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeToHours } from "../utils/rangeState";
import { businessDayExportNote } from "../utils/businessDay";
import { buildSalesCorrelation } from "../engines/salesCorrelationEngine";
import FoodicsIntelligence from "../FoodicsIntelligence";
import "../styles/platform-os.css";
import "../styles/foodics-intelligence.css";

function KpiCard({ label, value, sub }) {
  return (
    <motion.div className="nac-glass-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <p style={{ margin: 0, fontSize: "0.68rem", color: "rgba(249,249,247,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </p>
      <p style={{ margin: "0.35rem 0 0", fontSize: "1.65rem", fontWeight: 500 }}>{value}</p>
      {sub && <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "rgba(249,249,247,0.45)" }}>{sub}</p>}
    </motion.div>
  );
}

export default function SalesImportsIntelligence() {
  const filters = usePlatformFiltersOptional();
  const [salesItems, setSalesItems] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const pHours = filters?.timeRangeHours ?? rangeToHours(filters?.selectedRange || "today");
      const branch = filters?.branch || null;

      const [batchList, latest, rpc] = await Promise.all([
        getImportBatches(12),
        getLatestBatch(),
        supabase.rpc("get_bi_dashboard", { p_branch: branch, p_hours: pHours }),
      ]);

      setBatches(batchList);
      if (latest?.id) {
        setSalesItems(await getBatchSalesItems(latest.id));
      } else {
        setSalesItems([]);
      }
      setTopItems(normalizeTopItems(rpc.data?.top_items || []));
    } catch {
      setSalesItems([]);
      setTopItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters?.selectedRange, filters?.timeRangeHours, filters?.branch]);

  useEffect(() => {
    load();
  }, [load]);

  const correlation = useMemo(
    () => buildSalesCorrelation({ salesItems, topItems }),
    [salesItems, topItems],
  );

  if (loading && !batches.length) {
    return <p className="nac-empty-state">Loading sales imports…</p>;
  }

  return (
    <motion.div className="nac-sales-imports" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <p style={{ margin: "0 0 1.25rem", fontSize: "0.8rem", color: "rgba(249,249,247,0.5)" }}>
        {businessDayExportNote()} · Menu filters apply to visibility metrics
      </p>

      <motion.div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <KpiCard label="Imported net sales" value={`${Math.round(correlation.totals.net_sales).toLocaleString()} SAR`} />
        <KpiCard label="Units sold" value={correlation.totals.quantity.toLocaleString()} />
        <KpiCard label="Sell-through rate" value={`${correlation.attachmentRate}%`} sub="Items with orders vs menu signals" />
        <KpiCard
          label="Import batches"
          value={batches.length}
          sub={batches[0] ? `Latest ${batches[0].period_start}` : "Upload Foodics export"}
        />
      </motion.div>

      <motion.div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <motion.div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <Users size={16} color="#d7bc8a" /> Waiter performance
          </h3>
          {correlation.waiterKpis.length === 0 ? (
            <p className="nac-empty-state">Import sales with waiter column to unlock</p>
          ) : (
            correlation.waiterKpis.slice(0, 6).map((w) => (
              <div key={w.waiter} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", fontSize: "0.85rem" }}>
                <span>{w.waiter}</span>
                <strong>
                  {w.net_sales.toLocaleString()} SAR · {w.quantity} units
                </strong>
              </div>
            ))
          )}
        </motion.div>

        <motion.div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <AlertTriangle size={16} color="#f5a623" /> High interest · low sales
          </h3>
          {correlation.highInterestLowSales.length === 0 ? (
            <p className="nac-empty-state">No gaps detected in this batch</p>
          ) : (
            correlation.highInterestLowSales.map((r) => (
              <motion.div key={r.item_name} style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                <strong>{r.item_name}</strong>
                <p style={{ margin: 0, color: "rgba(249,249,247,0.5)" }}>
                  {r.item_views} views · {r.quantity_sold} sold
                </p>
              </motion.div>
            ))
          )}
        </motion.div>

        <motion.div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <TrendingUp size={16} color="#4ecdc4" /> Top upsellers
          </h3>
          {correlation.topUpsellers.map((w) => (
            <div key={w.waiter} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.35rem 0" }}>
              <span>{w.waiter}</span>
              <span>{w.net_sales.toLocaleString()} SAR</span>
            </div>
          ))}
        </motion.div>
      </motion.div>

      <motion.div className="nac-glass-panel" style={{ marginBottom: "2rem" }}>
        <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
          <ShoppingBag size={16} /> Viewed vs sold (latest import)
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table className="fi-table" style={{ width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Views</th>
                <th>Orders</th>
                <th>Conv %</th>
                <th>Net sales</th>
              </tr>
            </thead>
            <tbody>
              {correlation.conversionRows.slice(0, 12).map((r) => (
                <tr key={r.item_name}>
                  <td>{r.item_name}</td>
                  <td>{r.item_views ?? r.item_impressions ?? 0}</td>
                  <td>{r.quantity_sold}</td>
                  <td>{r.impression_conversion_pct ?? r.conversion_rate ?? "—"}</td>
                  <td>{Number(r.net_sales || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
        <Upload size={18} color="#d7bc8a" />
        <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 500 }}>Import Foodics CSV / XLSX</h2>
      </div>
      <FoodicsIntelligence />
    </motion.div>
  );
}
