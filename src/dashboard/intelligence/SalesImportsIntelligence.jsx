import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Users, AlertTriangle, ShoppingBag } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { getImportBatches, getBatchSalesItems, getLatestBatchByType } from "../../lib/foodicsApi";
import { normalizeTopItems } from "../utils/topItemsNormalize";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeToHours } from "../utils/rangeState";
import { businessDayExportNote } from "../utils/businessDay";
import { buildSalesCorrelation } from "../engines/salesCorrelationEngine";
import FoodicsImportLane from "../components/FoodicsImportLane";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import "../styles/platform-os.css";
import "../styles/foodics-intelligence.css";
import "../styles/foodics-import-lanes.css";

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
  const [productItems, setProductItems] = useState([]);
  const [waiterItems, setWaiterItems] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [productBatch, setProductBatch] = useState(null);
  const [waiterBatch, setWaiterBatch] = useState(null);
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

      const [batchList, latestProduct, latestWaiter, rpc] = await Promise.all([
        getImportBatches(24),
        getLatestBatchByType(IMPORT_TYPE.PRODUCT_SALES, branch),
        getLatestBatchByType(IMPORT_TYPE.WAITER_PRODUCT_SALES, branch),
        supabase.rpc("get_bi_dashboard", { p_branch: branch, p_hours: pHours }),
      ]);

      setBatches(batchList);
      setProductBatch(latestProduct);
      setWaiterBatch(latestWaiter);

      const [prodSales, waiterSales] = await Promise.all([
        latestProduct?.id ? getBatchSalesItems(latestProduct.id) : Promise.resolve([]),
        latestWaiter?.id ? getBatchSalesItems(latestWaiter.id) : Promise.resolve([]),
      ]);
      setProductItems(prodSales);
      setWaiterItems(waiterSales);
      setTopItems(normalizeTopItems(rpc.data?.top_items || []));
    } catch {
      setProductItems([]);
      setWaiterItems([]);
      setTopItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters?.selectedRange, filters?.timeRangeHours, filters?.branch]);

  useEffect(() => {
    load();
  }, [load]);

  const correlation = useMemo(
    () => buildSalesCorrelation({ salesItems: productItems, topItems }),
    [productItems, topItems],
  );

  const waiterCorrelation = useMemo(() => {
    if (!waiterItems.length) return { waiterKpis: [], topUpsellers: [] };
    const byWaiter = {};
    waiterItems.forEach((row) => {
      const w = (row.waiter_name || "Unassigned").trim() || "Unassigned";
      if (!byWaiter[w]) byWaiter[w] = { waiter: w, quantity: 0, net_sales: 0 };
      byWaiter[w].quantity += Number(row.quantity_sold) || 0;
      byWaiter[w].net_sales += Number(row.net_sales) || 0;
    });
    const waiterKpis = Object.values(byWaiter).sort((a, b) => b.net_sales - a.net_sales);
    return { waiterKpis, topUpsellers: waiterKpis.slice(0, 6) };
  }, [waiterItems]);

  if (loading && !batches.length) {
    return <p className="nac-empty-state">Loading sales imports…</p>;
  }

  return (
    <motion.div className="nac-sales-imports" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <p style={{ margin: "0 0 1.25rem", fontSize: "0.8rem", color: "rgba(249,249,247,0.5)" }}>
        {businessDayExportNote()} · Product lane drives menu intelligence · Waiter lane drives staff intelligence
      </p>

      <motion.div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <KpiCard
          label="Product import net sales"
          value={`${Math.round(correlation.totals.net_sales).toLocaleString()} SAR`}
          sub={productBatch ? `${productBatch.period_start} → ${productBatch.period_end}` : "Upload product sales"}
        />
        <KpiCard label="Product units" value={correlation.totals.quantity.toLocaleString()} />
        <KpiCard label="Sell-through rate" value={`${correlation.attachmentRate}%`} sub="Menu signals vs product import" />
        <KpiCard
          label="Waiter import rows"
          value={waiterItems.length.toLocaleString()}
          sub={waiterBatch ? `Latest ${waiterBatch.period_start}` : "Upload waiter product sales"}
        />
      </motion.div>

      <motion.div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <motion.div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <Users size={16} color="#d7bc8a" /> Waiter performance
          </h3>
          {!waiterBatch ? (
            <p className="nac-empty-state">Upload Waiter Product Sales to activate staff intelligence</p>
          ) : waiterCorrelation.waiterKpis.length === 0 ? (
            <p className="nac-empty-state">No waiter rows in latest batch</p>
          ) : (
            waiterCorrelation.waiterKpis.slice(0, 6).map((w) => (
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
            <p className="nac-empty-state">No gaps detected in product batch</p>
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
          {!waiterBatch ? (
            <p className="nac-empty-state">Requires waiter product sales import</p>
          ) : (
            waiterCorrelation.topUpsellers.map((w) => (
              <motion.div key={w.waiter} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "0.35rem 0" }}>
                <span>{w.waiter}</span>
                <span>{w.net_sales.toLocaleString()} SAR</span>
              </motion.div>
            ))
          )}
        </motion.div>
      </motion.div>

      <motion.div className="nac-glass-panel" style={{ marginBottom: "2rem" }}>
        <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
          <ShoppingBag size={16} /> Viewed vs sold (product import)
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

      <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem", fontWeight: 500 }}>Import lanes</h2>
      <div className="fi-import-lanes-grid">
        <FoodicsImportLane
          importType={IMPORT_TYPE.PRODUCT_SALES}
          latestBatch={productBatch}
          onImported={load}
        />
        <FoodicsImportLane
          importType={IMPORT_TYPE.WAITER_PRODUCT_SALES}
          latestBatch={waiterBatch}
          onImported={load}
        />
      </div>
    </motion.div>
  );
}
