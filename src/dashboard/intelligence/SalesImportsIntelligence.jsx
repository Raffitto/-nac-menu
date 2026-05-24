import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Users, AlertTriangle, ShoppingBag } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { getImportBatches, getBatchSalesItems, getLatestBatchByType } from "../../lib/foodicsApi";
import { normalizeTopItems } from "../utils/topItemsNormalize";
import { useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { businessDayExportNote } from "../utils/businessDay";
import { buildSalesCorrelation } from "../engines/salesCorrelationEngine";
import { formatExecutiveConversion } from "../utils/intelligenceSanity";
import { buildWaiterSalesIntelligence } from "../engines/waiterSalesEngine";
import FoodicsImportLane from "../components/FoodicsImportLane";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { NAC_ANALYTICS_EPOCH_START } from "../config/operationalEpoch";
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
  const rbac = useRbacOptional();
  const rbacProfile = rbac?.profile || null;
  const { data: biData } = useMenuBiDashboardContext();
  const [salesItems, setSalesItems] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [salesBatch, setSalesBatch] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const branch = resolveRbacQueryBranch(rbacProfile, filters?.branch || null);

      const [batchList, latestSales] = await Promise.all([
        getImportBatches(24, IMPORT_TYPE.WAITER_PRODUCT_SALES, rbacProfile),
        getLatestBatchByType(IMPORT_TYPE.WAITER_PRODUCT_SALES, branch, rbacProfile),
      ]);

      setBatches(batchList);
      setSalesBatch(latestSales);

      const rows = latestSales?.id ? await getBatchSalesItems(latestSales.id) : [];
      setSalesItems(rows);
      setTopItems(normalizeTopItems(biData?.top_items || []));
    } catch {
      setSalesItems([]);
      setTopItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters?.branch, biData?.top_items, rbacProfile]);

  useEffect(() => {
    load();
  }, [load]);

  const correlation = useMemo(
    () =>
      buildSalesCorrelation({
        salesItems,
        topItems,
        totalSessions: biData?.total_sessions || 0,
      }),
    [salesItems, topItems, biData?.total_sessions],
  );

  const waiterIntel = useMemo(() => {
    if (!salesItems.length) return { waiters: [], topUpsellers: [] };
    const intel = buildWaiterSalesIntelligence(salesItems);
    return { waiters: intel.waiters, topUpsellers: intel.waiters.slice(0, 6) };
  }, [salesItems]);

  if (loading && !batches.length) {
    return <p className="nac-empty-state">Loading operational sales data…</p>;
  }

  return (
    <motion.div className="nac-sales-imports" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <p style={{ margin: "0 0 1.25rem", fontSize: "0.8rem", color: "rgba(249,249,247,0.5)" }}>
        {businessDayExportNote()} · Sales = waiter import · Behavior = menu_events · Reputation = review_events · Trusted epoch from {NAC_ANALYTICS_EPOCH_START}
      </p>

      <motion.div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <KpiCard
          label="Operational net sales"
          value={`${Math.round(correlation.totals.net_sales).toLocaleString()} SAR`}
          sub={salesBatch ? `${salesBatch.period_start} → ${salesBatch.period_end}` : "Upload sales by creator"}
        />
        <KpiCard label="Units sold" value={correlation.totals.quantity.toLocaleString()} />
        <KpiCard
          label="Menu attach signal"
          value={correlation.attachmentRate != null ? `${correlation.attachmentRate}%` : "—"}
          sub="Items with sales vs menu visibility rows"
        />
        <KpiCard
          label="Sales import lines"
          value={salesItems.length.toLocaleString()}
          sub={salesBatch ? `Latest batch · ${salesBatch.branch_id}` : "No batch"}
        />
      </motion.div>

      {correlation.integrityMessage ? (
        <motion.div
          className="nac-glass-panel"
          style={{ marginBottom: "1rem", borderColor: "rgba(245,166,35,0.45)" }}
        >
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#f5a623" }}>
            <AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            {correlation.integrityMessage} — ranking insights suppressed until totals reconcile.
          </p>
        </motion.div>
      ) : null}

      {correlation.operationalTrust ? (
        <p style={{ margin: "0 0 1rem", fontSize: "0.75rem", color: "rgba(249,249,247,0.45)" }}>
          Operational trust score: {correlation.operationalTrust.score}/100 ({correlation.operationalTrust.tier})
        </p>
      ) : null}

      <motion.div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <motion.div className="nac-glass-panel">
          <h3 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
            <Users size={16} color="#d7bc8a" /> Waiter sales ranking
          </h3>
          {!salesBatch ? (
            <p className="nac-empty-state">Upload operational sales import (Foodics by creator)</p>
          ) : waiterIntel.waiters.length === 0 ? (
            <p className="nac-empty-state">No sales rows in latest batch</p>
          ) : (
            waiterIntel.waiters.slice(0, 6).map((w) => (
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
            <AlertTriangle size={16} color="#f5a623" /> High menu interest · low sales
          </h3>
          {correlation.highInterestLowSales.length === 0 ? (
            <p className="nac-empty-state">No visibility gaps in current period</p>
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
            <TrendingUp size={16} color="#4ecdc4" /> Top sellers (waiter)
          </h3>
          {!salesBatch ? (
            <p className="nac-empty-state">Requires operational sales import</p>
          ) : (
            waiterIntel.topUpsellers.map((w) => (
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
          <ShoppingBag size={16} /> Menu visibility vs operational sales
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table className="fi-table" style={{ width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Views</th>
                <th>Units sold</th>
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
                  <td>{formatExecutiveConversion(r)}</td>
                  <td>{Number(r.net_sales || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      <h2 style={{ margin: "0 0 1rem", fontSize: "1.15rem", fontWeight: 500 }}>Sales import</h2>
      <div className="fi-import-lanes-grid">
        <FoodicsImportLane
          importType={IMPORT_TYPE.WAITER_PRODUCT_SALES}
          latestBatch={salesBatch}
          onImported={load}
        />
      </div>
    </motion.div>
  );
}
