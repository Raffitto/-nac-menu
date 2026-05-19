import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  Link2,
  Clock,
  Grid3X3,
  Users,
  Loader2,
  AlertTriangle,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { getLatestBatchByType, getBatchSalesItems } from "../../lib/foodicsApi";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { defaultExportConfig } from "../config/visualExportPresets";
import { applyVisualExportConfig } from "../engines/visualExportApply";
import { buildWaiterTargets } from "../engines/waiterTargetEngine";
import VisualExportConfig from "../components/VisualExportConfig";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeToHours, rangeExportLabel } from "../utils/rangeState";
import { businessDayExportNote } from "../utils/businessDay";
import { buildRestaurantIntelligence } from "../engines/analyticsEngine";
import { buildAttachmentIntelligence } from "../engines/attachmentEngine";
import { buildTimeShiftIntelligence } from "../engines/timeShiftEngine";
import { buildHeatScores } from "../engines/heatScoreEngine";
import { buildWaiterSalesIntelligence } from "../engines/waiterSalesEngine";
import { buildVisualInsights } from "../engines/visualInsightEngine";
import { classifyMenuItems } from "../engines/menuEngineeringEngine";
import "../styles/visual-intelligence.css";

const TOOLTIP = {
  background: "rgba(8,8,10,0.92)",
  border: "1px solid rgba(215,188,138,0.25)",
  borderRadius: 12,
  color: "#f9f9f7",
  fontSize: 12,
};

function heatColor(pct) {
  if (pct >= 70) return "rgba(78,205,196,0.85)";
  if (pct >= 40) return "rgba(215,188,138,0.75)";
  if (pct >= 15) return "rgba(245,166,35,0.65)";
  return "rgba(255,255,255,0.12)";
}

function Section({ title, subtitle, children }) {
  return (
    <section className="vi-section">
      <div className="vi-section-head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function VisualIntelligenceEngine() {
  const filters = usePlatformFiltersOptional();
  const [loading, setLoading] = useState(true);
  const [biData, setBiData] = useState(null);
  const [productItems, setProductItems] = useState([]);
  const [waiterItems, setWaiterItems] = useState([]);
  const [hasWaiterBatch, setHasWaiterBatch] = useState(false);
  const [exportConfig, setExportConfig] = useState(() => defaultExportConfig());
  const [exporting, setExporting] = useState(false);

  const pHours = filters?.timeRangeHours ?? rangeToHours(filters?.selectedRange || "today");
  const rangeLabel = rangeExportLabel(filters?.selectedRange || "today");

  const load = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const branch = filters?.branch || null;
      const [rpc, latestProduct, latestWaiter] = await Promise.all([
        supabase.rpc("get_bi_dashboard", {
          p_branch: branch,
          p_hours: pHours,
        }),
        getLatestBatchByType(IMPORT_TYPE.PRODUCT_SALES, branch),
        getLatestBatchByType(IMPORT_TYPE.WAITER_PRODUCT_SALES, branch),
      ]);
      if (!rpc.error) setBiData(rpc.data);
      setHasWaiterBatch(Boolean(latestWaiter?.id));
      const [prod, waiter] = await Promise.all([
        latestProduct?.id ? getBatchSalesItems(latestProduct.id) : Promise.resolve([]),
        latestWaiter?.id ? getBatchSalesItems(latestWaiter.id) : Promise.resolve([]),
      ]);
      setProductItems(prod);
      setWaiterItems(waiter);
    } catch {
      setBiData(null);
      setProductItems([]);
      setWaiterItems([]);
      setHasWaiterBatch(false);
    } finally {
      setLoading(false);
    }
  }, [filters?.branch, pHours]);

  useEffect(() => {
    load();
  }, [load]);

  const intelligence = useMemo(() => buildRestaurantIntelligence(biData, null), [biData]);
  const funnels = useMemo(() => intelligence?.funnels || [], [intelligence]);
  const addonPairs = useMemo(() => biData?.top_addon_pairs || [], [biData]);

  const attachment = useMemo(
    () => buildAttachmentIntelligence({ salesItems: productItems, addonPairs }),
    [productItems, addonPairs],
  );

  const timeShift = useMemo(
    () => buildTimeShiftIntelligence({ biData, salesItems: productItems }),
    [biData, productItems],
  );

  const menuEngineering = useMemo(() => classifyMenuItems(funnels), [funnels]);

  const heat = useMemo(
    () => buildHeatScores({ funnels, salesItems: productItems, modifierLeaderboard: attachment.modifierLeaderboard }),
    [funnels, productItems, attachment.modifierLeaderboard],
  );

  const waiters = useMemo(
    () => (hasWaiterBatch ? buildWaiterSalesIntelligence(waiterItems) : { waiters: [], topUpseller: null }),
    [waiterItems, hasWaiterBatch],
  );

  const waiterTargets = useMemo(() => buildWaiterTargets(waiters), [waiters]);

  const waiterNames = useMemo(
    () => (waiters?.waiters || []).map((w) => w.waiter),
    [waiters],
  );

  useEffect(() => {
    if (waiterNames.length && !exportConfig.selectedWaiters?.length) {
      setExportConfig((c) => ({ ...c, selectedWaiters: waiterNames }));
    }
  }, [waiterNames, exportConfig.selectedWaiters?.length]);

  const insights = useMemo(
    () => buildVisualInsights({ attachment, timeShift, heat, menuEngineering, waiters }),
    [attachment, timeShift, heat, menuEngineering, waiters],
  );

  const baseExportPayload = useMemo(
    () => ({
      attachment,
      timeShift,
      heat,
      menuEngineering,
      waiters,
      waiterTargets,
      insights,
      kpis: intelligence?.kpis,
      funnels,
      hasWaiterBatch,
      exportMeta: { title: `Visual Intelligence — ${rangeLabel}`, period: rangeLabel },
    }),
    [attachment, timeShift, heat, menuEngineering, waiters, waiterTargets, insights, intelligence, funnels, rangeLabel, hasWaiterBatch],
  );

  const runExport = async (fmt) => {
    setExporting(true);
    try {
      const payload = applyVisualExportConfig(baseExportPayload, exportConfig);
      const mod = await import("../engines/exportEngine");
      if (fmt === "pdf") mod.exportVisualIntelligencePDF(payload);
      else mod.exportVisualIntelligenceXLSX(payload);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <motion.div className="vi-page" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 200 }}>
        <Loader2 size={22} className="nac-bi-spin" />
        <span>Building visual intelligence…</span>
      </motion.div>
    );
  }

  const hourlyCombined = (timeShift.hourlyMenu || []).map((m) => {
    const s = (timeShift.hourlySales || []).find((h) => h.hour === m.hour) || {};
    return { ...m, salesQty: s.salesQty || 0, modifierQty: s.modifierQty || 0 };
  });

  return (
    <motion.div className="vi-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: "rgba(249,249,247,0.45)" }}>
        {businessDayExportNote()} · Product lane + waiter lane imports · Configure exports below
      </p>

      <VisualExportConfig
        config={exportConfig}
        onChange={setExportConfig}
        waiterNames={waiterNames}
        exporting={exporting}
        onExportPdf={() => runExport("pdf")}
        onExportXlsx={() => runExport("xlsx")}
      />

      <div className="vi-kpi-grid">
        <div className="vi-kpi">
          <p className="vi-kpi-label">Modifier revenue</p>
          <p className="vi-kpi-value">{Math.round(attachment.totals.modifierRevenue).toLocaleString()} SAR</p>
        </div>
        <div className="vi-kpi">
          <p className="vi-kpi-label">Parent orders (import)</p>
          <p className="vi-kpi-value">{attachment.totals.parentOrders.toLocaleString()}</p>
        </div>
        <div className="vi-kpi">
          <p className="vi-kpi-label">Missed upsell signals</p>
          <p className="vi-kpi-value" style={{ color: attachment.missedUpsells.length ? "#f5a623" : "#4ecdc4" }}>
            {attachment.missedUpsells.length}
          </p>
        </div>
        <div className="vi-kpi">
          <p className="vi-kpi-label">Hot items</p>
          <p className="vi-kpi-value">{heat.hotNow.length}</p>
        </div>
      </div>

      {/* AI Insights */}
      <Section title="AI Operational Insights" subtitle="Actionable patterns from sales, menu, and attachment signals">
        <div className="vi-grid-2">
          {insights.slice(0, 6).map((ins) => (
            <motion.div key={ins.id} className={`vi-insight-card ${ins.type}`} layout>
              <span className={`vi-badge ${ins.confidence}`}>{ins.confidence} confidence</span>
              <strong style={{ display: "block", marginBottom: 4 }}>{ins.title}</strong>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(249,249,247,0.65)" }}>{ins.body}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Phase 1 — Attachment */}
      <Section title="Attachment & upsell intelligence" subtitle="What gets sold with what — rule-based pairs from Foodics imports">
        <div className="vi-grid-2">
          <div className="vi-panel">
            <h3><Link2 size={16} color="#d7bc8a" /> Top attachments</h3>
            <p className="vi-subtitle">Highest attachment rates vs parent volume</p>
            {attachment.topAttachments.length === 0 ? (
              <p className="nac-empty-state">Import sales to unlock attachment leaderboard</p>
            ) : (
              attachment.topAttachments.map((p) => (
                <motion.div key={p.id} className="vi-bar-row">
                  <div className="vi-bar-label">
                    <span>{p.label}</span>
                    <span>
                      {p.attachmentRate}% · {p.expectedPct}% target
                    </span>
                  </div>
                  <div className="vi-bar-track">
                    <div
                      className={`vi-bar-fill ${p.heat}`}
                      style={{ width: `${Math.min(100, (p.attachmentRate / Math.max(p.expectedPct, 1)) * 100)}%` }}
                    />
                  </div>
                </motion.div>
              ))
            )}
          </div>

          <div className="vi-panel">
            <h3><AlertTriangle size={16} color="#e85d4c" /> Missed upsells</h3>
            <p className="vi-subtitle">High parent volume · low modifier attachment vs expected threshold</p>
            {attachment.missedUpsells.length === 0 ? (
              <p className="nac-empty-state">No critical gaps vs configured thresholds</p>
            ) : (
              attachment.missedUpsells.slice(0, 5).map((m) => (
                <div key={m.id} className="vi-missed-card">
                  <span className="vi-opp-score">Opportunity score {m.opportunityScore}</span>
                  <strong>{m.label}</strong>
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "rgba(249,249,247,0.6)" }}>
                    {m.parentOrders.toLocaleString()} parents · {m.attachmentRate}% attach (expected {m.expectedPct}%)
                    · est. gap ~{m.estimatedLostRevenue.toLocaleString()} SAR
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="vi-grid-2" style={{ marginTop: "1rem" }}>
          <div className="vi-panel">
            <h3>Modifier revenue heatmap</h3>
            <p className="vi-subtitle">Top modifiers by imported revenue</p>
            <div className="vi-chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attachment.modifierLeaderboard.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fill: "rgba(249,249,247,0.6)", fontSize: 9 }} />
                  <Tooltip contentStyle={TOOLTIP} />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {attachment.modifierLeaderboard.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={i % 2 ? "#4ecdc4" : "#d7bc8a"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="vi-panel">
            <h3>Frequently bought together</h3>
            <p className="vi-subtitle">Menu click pairs + import heuristics</p>
            {(attachment.clickPairs.length ? attachment.clickPairs : attachment.pairs.slice(0, 6)).map((p, i) => (
              <div key={i} className="vi-rel-card">
                <strong>{p.parent || p.label}</strong>
                {" → "}
                {p.modifier || (p.modifierPatterns || []).join(", ")}
                {p.clicks != null && <span style={{ float: "right", opacity: 0.6 }}>{p.clicks} clicks</span>}
                {p.attachmentRate != null && (
                  <span style={{ float: "right", opacity: 0.6 }}>{p.attachmentRate}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Phase 2 — Time */}
      <Section title="Time & shift intelligence" subtitle="Dayparts, hourly conversion, weekday vs weekend">
        <div className="vi-grid-2">
          <div className="vi-panel">
            <h3><Clock size={16} /> Sales by hour</h3>
            <div className="vi-chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyCombined}>
                  <defs>
                    <linearGradient id="viSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4ecdc4" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#4ecdc4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 9 }} />
                  <YAxis tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                  <Tooltip contentStyle={TOOLTIP} />
                  <Area type="monotone" dataKey="salesQty" stroke="#4ecdc4" fill="url(#viSales)" name="Units" />
                  <Area type="monotone" dataKey="menuEvents" stroke="#d7bc8a" fill="none" name="Menu events" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="vi-panel">
            <h3>Menu opens by hour</h3>
            <div className="vi-chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeShift.hourlyMenu}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 9 }} />
                  <YAxis tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                  <Tooltip contentStyle={TOOLTIP} />
                  <Line type="monotone" dataKey="menuEvents" stroke="#d7bc8a" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="vi-grid-2" style={{ marginTop: "1rem" }}>
          <div className="vi-panel">
            <h3>Conversion by hour</h3>
            <div className="vi-heatmap-grid">
              {(timeShift.conversionByHour || [])
                .filter((_, i) => i % 2 === 0)
                .slice(0, 12)
                .map((c) => (
                  <motion.div
                    key={c.hour}
                    className="vi-heatmap-cell"
                    style={{ background: heatColor(c.conversion) }}
                    title={`${c.label}: ${c.conversion}%`}
                  >
                    {c.hour}
                  </motion.div>
                ))}
            </div>
          </div>

          <div className="vi-panel">
            <h3>Weekday vs weekend</h3>
            <div className="vi-bar-row">
              <div className="vi-bar-label">
                <span>Weekday sales</span>
                <span>{timeShift.weekdayWeekend.weekday.salesQty}</span>
              </div>
              <div className="vi-bar-track">
                <div
                  className="vi-bar-fill good"
                  style={{
                    width: `${Math.min(
                      100,
                      (timeShift.weekdayWeekend.weekday.salesQty /
                        Math.max(
                          timeShift.weekdayWeekend.weekday.salesQty + timeShift.weekdayWeekend.weekend.salesQty,
                          1,
                        )) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <div className="vi-bar-row">
              <div className="vi-bar-label">
                <span>Weekend sales</span>
                <span>{timeShift.weekdayWeekend.weekend.salesQty}</span>
              </div>
              <div className="vi-bar-track">
                <div
                  className="vi-bar-fill warn"
                  style={{
                    width: `${Math.min(
                      100,
                      (timeShift.weekdayWeekend.weekend.salesQty /
                        Math.max(
                          timeShift.weekdayWeekend.weekday.salesQty + timeShift.weekdayWeekend.weekend.salesQty,
                          1,
                        )) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            {timeShift.peakDaypart && (
              <p style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "rgba(249,249,247,0.55)" }}>
                Peak daypart: <strong style={{ color: "#d7bc8a" }}>{timeShift.peakDaypart.label}</strong>
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* Phase 3 — Menu engineering */}
      <Section title="Menu engineering score" subtitle="BCG-style quadrant — popularity × profitability × engagement">
        <div className="vi-grid-2">
          <div className="vi-panel">
            <h3><Grid3X3 size={16} /> Positioning map</h3>
            <div className="vi-chart-wrap" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" dataKey="popularity" name="Popularity" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                  <YAxis type="number" dataKey="profitability" name="Profitability" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                  <Tooltip contentStyle={TOOLTIP} cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter data={menuEngineering.slice(0, 24)} fill="#4ecdc4">
                    {menuEngineering.slice(0, 24).map((m, i) => (
                      <Cell
                        key={i}
                        fill={
                          m.quadrant === "Star"
                            ? "#4ecdc4"
                            : m.quadrant === "Puzzle"
                              ? "#f5a623"
                              : m.quadrant === "Workhorse"
                                ? "#d7bc8a"
                                : "rgba(255,255,255,0.35)"
                        }
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="vi-panel">
            <h3>Item performance cards</h3>
            {menuEngineering.slice(0, 8).map((m) => (
              <div key={m.item_name} style={{ fontSize: "0.8rem", padding: "0.4rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {m.item_name}
                <span className={`vi-quadrant-tag ${m.quadrant}`}>{m.quadrant}</span>
                <span style={{ float: "right", opacity: 0.55 }}>
                  {m.views} views · {m.orders} orders
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Phase 4 — Staff */}
      <Section title="Waiter & staff intelligence" subtitle="Requires Waiter Product Sales import (Sales by Creator, group by product)">
        <div className="vi-grid-2">
          <div className="vi-panel vi-podium">
            <h3><Users size={16} /> Top upseller podium</h3>
            {!hasWaiterBatch ? (
              <p className="nac-empty-state">Upload Waiter Product Sales to activate staff intelligence</p>
            ) : waiters.topUpseller ? (
              <>
                <p style={{ fontSize: "2rem", margin: "0.5rem 0 0" }}>🥇</p>
                <p className="vi-podium-name">{waiters.topUpseller.waiter}</p>
                <p style={{ margin: 0, fontSize: "0.85rem" }}>
                  {waiters.topUpseller.net_sales.toLocaleString()} SAR · {waiters.topUpseller.modifierAttachPct}% mods
                </p>
              </>
            ) : (
              <p className="nac-empty-state">No waiter rows in latest batch</p>
            )}
          </div>

          <div className="vi-panel">
            <h3>Staff comparison</h3>
            {!hasWaiterBatch ? (
              <p className="nac-empty-state">Upload Waiter Product Sales to activate staff intelligence</p>
            ) : (
              <>
                <motion.div className="vi-chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={waiters.radarTop}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="waiter" tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 9 }} />
                      <YAxis tick={{ fill: "rgba(249,249,247,0.5)", fontSize: 10 }} />
                      <Tooltip contentStyle={TOOLTIP} />
                      <Bar dataKey="modifier" fill="#4ecdc4" name="Modifier %" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="dessert" fill="#d7bc8a" name="Dessert %" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
                <p style={{ fontSize: "0.72rem", marginTop: "0.5rem", color: "rgba(249,249,247,0.45)" }}>
                  Dessert champion: {waiters.dessertChampion?.waiter || "—"} · Beverage: {waiters.beverageChampion?.waiter || "—"}
                </p>
              </>
            )}
          </div>
        </div>

        {hasWaiterBatch && waiterTargets.length > 0 && (
          <div className="vi-panel" style={{ marginTop: "1rem" }}>
            <h3>Weekly target cards</h3>
            <p className="vi-subtitle">Per-waiter push recommendations for next week</p>
            <motion.div className="vi-grid-2">
              {waiterTargets.slice(0, 6).map((t) => (
                <div key={t.waiter} className={`vi-insight-card ${t.priority === "mentor" ? "win" : "opportunity"}`}>
                  <strong>{t.headline}</strong>
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "rgba(249,249,247,0.6)" }}>{t.detail}</p>
                  <span className="vi-badge medium">Push: {t.pushNextWeek}</span>
                </div>
              ))}
            </motion.div>
          </div>
        )}
      </Section>

      {/* Phase 5 — Heat */}
      <Section title="Heat score index" subtitle="Unified ranking — views, orders, conversion, revenue, modifier lift">
        <div className="vi-grid-2">
          <div className="vi-panel">
            <h3><Flame size={16} color="#4ecdc4" /> Hot now</h3>
            {heat.hotNow.map((h) => (
              <div key={h.item_name} className={`vi-heat-card ${h.band}`}>
                <span style={{ display: "flex", alignItems: "center" }}>
                  <span className={`vi-heat-glow ${h.band}`} />
                  {h.item_name}
                </span>
                <strong>{h.heatIndex}</strong>
              </div>
            ))}
            {!heat.hotNow.length && <p className="nac-empty-state">Building heat signals…</p>}
          </div>

          <div className="vi-panel">
            <h3><Sparkles size={16} /> Hidden gems & gaps</h3>
            {heat.hiddenGems.slice(0, 4).map((h) => (
              <div key={h.item_name} className="vi-heat-card">
                <span>💎 {h.item_name}</span>
                <span>{h.orders} orders / {h.views} views</span>
              </div>
            ))}
            {heat.highInterestLowSales.slice(0, 3).map((h) => (
              <div key={`hil-${h.item_name}`} className="vi-heat-card" style={{ borderColor: "rgba(245,166,35,0.3)" }}>
                <span><TrendingUp size={12} /> {h.item_name}</span>
                <span>High interest</span>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </motion.div>
  );
}
