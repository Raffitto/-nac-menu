import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useMenuBiDashboard } from "../hooks/useMenuBiDashboard";
import BiLiveFallbackBanner from "../components/BiLiveFallbackBanner";
import PlatformStatusBanner from "../components/PlatformStatusBanner";
import { isBiTopItemsEmpty, hasMenuBiActivity } from "../../lib/biDashboardNormalize";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";
import { defaultExportConfig } from "../config/visualExportPresets";
import { loadWeeklyFocusItems, saveWeeklyFocusItems } from "../config/weeklyFocusStorage";
import { loadWaiterSalesMetric, saveWaiterSalesMetric } from "../config/waiterSalesMetricStorage";
import { waiterSalesValue } from "../utils/waiterSalesMetric";
import { buildFocusItemCatalog } from "../utils/focusItemCatalog";
import { applyVisualExportConfig } from "../engines/visualExportApply";
import { buildWaiterCoaching } from "../engines/waiterCoachingEngine";
import { buildStaffOperationalIntelligence } from "../engines/staffOperationalEngine";
import { calibrateWaiterProfiles, calibrateTeamContext } from "../engines/intelligenceCalibration";
import { enrichWaitersForVisuals } from "../engines/waiterVisualEngine";
import VisualExportConfig from "../components/VisualExportConfig";
import VisualExportCharts from "../components/VisualExportCharts";
import { WaiterComparisonDashboard, BeverageMixIntelligence } from "../components/OperationalVisualCharts";
import { captureVisualCharts } from "../utils/captureExportCharts";
import { partitionStaffByRole } from "../config/staffRoles";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { rangeExportLabel } from "../utils/rangeState";
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

function rebuildCompetitionIntel(base, list, salesMetric = "gross") {
  const sorted = [...list];
  return {
    ...base,
    waiters: sorted,
    salesMetric,
    topUpseller: sorted[0] || null,
    dessertChampion: [...sorted].sort((a, b) => b.dessertAttachPct - a.dessertAttachPct)[0] || null,
    beverageChampion:
      [...sorted].sort((a, b) => (b.ops?.premiumBevPct || 0) - (a.ops?.premiumBevPct || 0))[0] || null,
    radarTop: sorted.map((w) => ({
      waiter: w.waiter.length > 12 ? `${w.waiter.slice(0, 10)}…` : w.waiter,
      revenue: waiterSalesValue(w, salesMetric),
      modifier: w.modifierAttachPct,
      dessert: w.dessertAttachPct,
      beverage: w.beverageAttachPct,
      foodMix: w.foodMixPct,
      avgCheck: w.avgCheck,
    })),
    maxSales: sorted[0] ? waiterSalesValue(sorted[0], salesMetric) : 1,
  };
}

function RoleBadge({ roleLabel }) {
  const cls =
    roleLabel === "Manager" ? "vi-role-badge vi-role-badge--manager" : "vi-role-badge vi-role-badge--waiter";
  return <span className={cls}>{roleLabel}</span>;
}

export default function VisualIntelligenceEngine() {
  const filters = usePlatformFiltersOptional();
  const {
    data: biData,
    loading: biLoading,
    needsAuth,
    showFallbackBanner,
    menuDataEmpty,
    platformStatus,
  } = useMenuBiDashboard();
  const [importsLoading, setImportsLoading] = useState(true);
  const [productItems, setProductItems] = useState([]);
  const [waiterItems, setWaiterItems] = useState([]);
  const [hasWaiterBatch, setHasWaiterBatch] = useState(false);
  const [hasProductBatch, setHasProductBatch] = useState(false);
  const [exportConfig, setExportConfig] = useState(() => ({
    ...defaultExportConfig([], loadWeeklyFocusItems()),
    waiterSalesMetric: loadWaiterSalesMetric(),
  }));
  const [exporting, setExporting] = useState(false);
  const chartCaptureRef = useRef(null);

  const rangeLabel = rangeExportLabel(filters?.selectedRange || "today");

  const loadImports = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured() || needsAuth) {
      setImportsLoading(false);
      setProductItems([]);
      setWaiterItems([]);
      setHasWaiterBatch(false);
      setHasProductBatch(false);
      return;
    }
    setImportsLoading(true);
    try {
      const branch = filters?.branch || null;
      const [latestProduct, latestWaiter] = await Promise.all([
        getLatestBatchByType(IMPORT_TYPE.PRODUCT_SALES, branch),
        getLatestBatchByType(IMPORT_TYPE.WAITER_PRODUCT_SALES, branch),
      ]);
      setHasProductBatch(Boolean(latestProduct?.id));
      setHasWaiterBatch(Boolean(latestWaiter?.id));
      const [prod, waiter] = await Promise.all([
        latestProduct?.id ? getBatchSalesItems(latestProduct.id) : Promise.resolve([]),
        latestWaiter?.id ? getBatchSalesItems(latestWaiter.id) : Promise.resolve([]),
      ]);
      setProductItems(prod);
      setWaiterItems(waiter);
    } catch {
      setProductItems([]);
      setWaiterItems([]);
      setHasWaiterBatch(false);
      setHasProductBatch(false);
    } finally {
      setImportsLoading(false);
    }
  }, [filters?.branch, needsAuth]);

  useEffect(() => {
    if (!biLoading) loadImports();
  }, [biLoading, loadImports]);

  const loading = biLoading || importsLoading;
  const menuActivity = hasMenuBiActivity(biData);
  const menuItemsEmpty = !biLoading && menuActivity && isBiTopItemsEmpty(biData);

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

  const focusCatalog = useMemo(
    () => buildFocusItemCatalog(productItems, waiterItems),
    [productItems, waiterItems],
  );

  const weeklyFocusItems = useMemo(
    () => exportConfig.weeklyFocusItems || [],
    [exportConfig.weeklyFocusItems],
  );

  const salesMetric = exportConfig.waiterSalesMetric || loadWaiterSalesMetric();

  const staffIntel = useMemo(
    () =>
      hasWaiterBatch
        ? buildWaiterSalesIntelligence(waiterItems, {
            focusItems: weeklyFocusItems,
            salesMetric,
          })
        : { waiters: [], all: [], managers: [], topUpseller: null },
    [waiterItems, hasWaiterBatch, weeklyFocusItems, salesMetric],
  );

  const includeManagers = Boolean(exportConfig.includeManagers);

  const competitionStaff = useMemo(() => {
    const part = partitionStaffByRole(staffIntel.all || staffIntel.waiters || [], { includeManagers });
    return rebuildCompetitionIntel(staffIntel, includeManagers ? part.all : part.waiters, salesMetric);
  }, [staffIntel, includeManagers, salesMetric]);

  const calibratedStaff = useMemo(() => {
    if (!hasWaiterBatch || !waiterItems?.length) {
      return { waiters: competitionStaff.waiters || [], team: {} };
    }
    const ops = buildStaffOperationalIntelligence(waiterItems, competitionStaff, timeShift);
    const team = calibrateTeamContext(ops.team, ops.waiters);
    const waiters = enrichWaitersForVisuals(calibrateWaiterProfiles(ops.waiters, team));
    return { waiters, team };
  }, [competitionStaff, waiterItems, timeShift, hasWaiterBatch]);

  const waiterTargets = useMemo(
    () =>
      buildWaiterCoaching(calibratedStaff.waiters || [], {
        focusItems: weeklyFocusItems,
        team: calibratedStaff.team,
      }),
    [calibratedStaff, weeklyFocusItems],
  );

  const premiumBevChampion = useMemo(() => {
    const list = calibratedStaff.waiters || [];
    if (!list.length) return null;
    return [...list].sort((a, b) => (b.ops?.premiumBevPct || 0) - (a.ops?.premiumBevPct || 0))[0];
  }, [calibratedStaff]);

  const waiterNames = useMemo(
    () => (staffIntel.waiters || []).map((w) => w.waiter),
    [staffIntel],
  );

  useEffect(() => {
    if (!waiterNames.length) return;
    setExportConfig((c) => {
      const current = c.selectedWaiters || [];
      const missing = waiterNames.filter(
        (n) => !current.some((sel) => sel.toLowerCase() === n.toLowerCase()),
      );
      if (!missing.length && current.length) return c;
      return {
        ...c,
        selectedWaiters: [...new Set([...current, ...waiterNames])],
        allWaiters: c.allWaiters !== false,
      };
    });
  }, [waiterNames]);

  const handleExportConfigChange = (next) => {
    if (next.weeklyFocusItems) {
      saveWeeklyFocusItems(next.weeklyFocusItems);
    }
    if (next.waiterSalesMetric && next.waiterSalesMetric !== exportConfig.waiterSalesMetric) {
      saveWaiterSalesMetric(next.waiterSalesMetric);
    }
    setExportConfig(next);
  };

  const insights = useMemo(
    () => buildVisualInsights({ attachment, timeShift, heat, menuEngineering, waiters: competitionStaff }),
    [attachment, timeShift, heat, menuEngineering, competitionStaff],
  );

  const baseExportPayload = useMemo(
    () => ({
      attachment,
      timeShift,
      heat,
      menuEngineering,
      waiters: staffIntel,
      competitionStaff,
      waiterTargets,
      insights,
      kpis: intelligence?.kpis,
      funnels,
      hasWaiterBatch,
      waiterSalesItems: waiterItems,
      exportMeta: { title: `Visual Intelligence — ${rangeLabel}`, period: rangeLabel },
    }),
    [attachment, timeShift, heat, menuEngineering, staffIntel, competitionStaff, waiterTargets, insights, intelligence, funnels, rangeLabel, hasWaiterBatch, waiterItems],
  );

  const runExport = async (fmt) => {
    setExporting(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
      const chartImages = await captureVisualCharts(chartCaptureRef.current);
      const payload = applyVisualExportConfig(
        { ...baseExportPayload, waiters: competitionStaff, chartImages },
        exportConfig,
      );
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

  if (needsAuth) {
    return <p className="nac-empty-state">Sign in and refresh to load visual intelligence.</p>;
  }

  const hourlyCombined = (timeShift.hourlyMenu || []).map((m) => {
    const s = (timeShift.hourlySales || []).find((h) => h.hour === m.hour) || {};
    return { ...m, salesQty: s.salesQty || 0, modifierQty: s.modifierQty || 0 };
  });

  const clickPairRows = attachment.clickPairs.length
    ? attachment.clickPairs
    : attachment.pairs.slice(0, 6);

  return (
    <motion.div className="vi-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PlatformStatusBanner platformStatus={platformStatus} />
      <BiLiveFallbackBanner visible={showFallbackBanner && !platformStatus?.showUserBanner} />
      <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: "rgba(249,249,247,0.45)" }}>
        {businessDayExportNote()} · Product lane + waiter lane imports · Configure exports below
      </p>

      <VisualExportConfig
        config={exportConfig}
        onChange={handleExportConfigChange}
        waiterNames={waiterNames}
        focusCatalog={focusCatalog}
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
              <p className="nac-empty-state">
                {hasProductBatch ? "No attachment patterns in latest import" : "Import sales to unlock attachment leaderboard"}
              </p>
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
              <p className="nac-empty-state">
                {hasProductBatch ? "No critical gaps vs configured thresholds" : "Import sales to score missed upsells"}
              </p>
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
            {clickPairRows.length === 0 ? (
              <p className="nac-empty-state">
                {menuDataEmpty
                  ? "No menu activity in this period"
                  : addonPairs.length
                    ? "No paired add-on clicks yet"
                    : "Menu add-on pairs appear when guests click add-ons"}
              </p>
            ) : (
              clickPairRows.map((p, i) => (
                <div key={i} className="vi-rel-card">
                  <strong>{p.parent || p.label}</strong>
                  {" → "}
                  {p.modifier || (p.modifierPatterns || []).join(", ")}
                  {p.clicks != null && <span style={{ float: "right", opacity: 0.6 }}>{p.clicks} clicks</span>}
                  {p.attachmentRate != null && (
                    <span style={{ float: "right", opacity: 0.6 }}>{p.attachmentRate}%</span>
                  )}
                </div>
              ))
            )}
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

      {hasWaiterBatch && calibratedStaff.waiters?.length > 0 && (
        <>
          <Section
            title="Operational waiter comparison"
            subtitle="Revenue quality vs gross · shift-aware · who monetizes vs who inflates volume"
          >
            <WaiterComparisonDashboard waiters={calibratedStaff.waiters} salesMetric={salesMetric} />
          </Section>

          <Section
            title="Beverage quality intelligence"
            subtitle="Premium mix vs Pepsi/water — quality of drink revenue, not quantity"
          >
            <BeverageMixIntelligence waiters={calibratedStaff.waiters} />
          </Section>
        </>
      )}

      {/* Phase 4 — Staff */}
      <Section title="Waiter & staff intelligence" subtitle="Waiters only in competitions — managers excluded unless toggled">
        <label className="vi-check" style={{ marginBottom: "1rem" }}>
          <input
            type="checkbox"
            checked={includeManagers}
            onChange={(e) => setExportConfig((c) => ({ ...c, includeManagers: e.target.checked }))}
          />
          Include managers in analytics (Raffi, Fady, Bashar)
        </label>
        <div className="vi-grid-2">
          <div className="vi-panel vi-podium">
            <h3><Users size={16} /> Top upseller podium</h3>
            {!hasWaiterBatch ? (
              <p className="nac-empty-state">Upload Waiter Product Sales to activate staff intelligence</p>
            ) : competitionStaff.topUpseller ? (
              <>
                <p style={{ fontSize: "2rem", margin: "0.5rem 0 0" }}>🥇</p>
                <p className="vi-podium-name">
                  {competitionStaff.topUpseller.waiter}
                  <RoleBadge roleLabel={competitionStaff.topUpseller.roleLabel} />
                </p>
                <p style={{ margin: 0, fontSize: "0.85rem" }}>
                  {waiterSalesValue(competitionStaff.topUpseller, salesMetric).toLocaleString()} SAR ({salesMetric === "net" ? "net" : "gross"}) · {competitionStaff.topUpseller.modifierAttachPct}% mods
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
                    <BarChart data={competitionStaff.radarTop}>
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
                  Dessert champion: {competitionStaff.dessertChampion?.waiter || "—"} · Premium beverage: {premiumBevChampion?.waiter || "—"}
                </p>
              </>
            )}
          </div>
        </div>

        {hasWaiterBatch && !includeManagers && staffIntel.managers?.length > 0 && (
          <motion.div className="vi-panel" style={{ marginTop: "1rem" }}>
            <h3>Manager contribution (excluded from competitions)</h3>
            <p className="vi-subtitle">Operational overview — not ranked against waiters</p>
            {staffIntel.managers.map((m) => (
              <motion.div key={m.waiter} className="vi-heat-card" style={{ marginBottom: "0.35rem" }}>
                <span>
                  {m.waiter}
                  <RoleBadge roleLabel={m.roleLabel} />
                </span>
                <span>{waiterSalesValue(m, salesMetric).toLocaleString()} SAR · {m.quantity} qty</span>
              </motion.div>
            ))}
          </motion.div>
        )}

        {hasWaiterBatch && waiterTargets.length > 0 && (
          <div className="vi-panel" style={{ marginTop: "1rem" }}>
            <h3>Operational coaching</h3>
            <p className="vi-subtitle">Calibrated floor coaching — margin-first, shift-aware</p>
            <motion.div className="vi-grid-2">
              {waiterTargets.map((t) => (
                <motion.div
                  key={t.waiter}
                  className={`vi-insight-card ${t.severity === "low" ? "win" : t.severity === "high" ? "risk" : "opportunity"}`}
                >
                  <strong>{t.headline}</strong>
                  {(t.confidenceLabel || t.revenueQualityScore != null) && (
                    <motion.div style={{ marginTop: "0.25rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      {t.confidenceLabel && (
                        <span className={`vi-badge ${t.confidence === "low_sample" ? "low" : "medium"}`}>{t.confidenceLabel}</span>
                      )}
                      {t.revenueQualityScore != null && (
                        <span className="vi-badge medium">RQ {t.revenueQualityScore}/100</span>
                      )}
                    </motion.div>
                  )}
                  <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "rgba(249,249,247,0.6)" }}>
                    {t.narrative || t.action || t.detail}
                  </p>
                  {t.opportunity && (
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "rgba(215,188,138,0.85)" }}>
                      {t.opportunity}
                    </p>
                  )}
                </motion.div>
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
            {!heat.hotNow.length && (
              <p className="nac-empty-state">
                {menuDataEmpty
                  ? "No menu activity in this period"
                  : menuItemsEmpty
                    ? "No item views yet for heat ranking"
                    : "No heat signals for this range"}
              </p>
            )}
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

      <VisualExportCharts
        ref={chartCaptureRef}
        waiters={calibratedStaff.waiters?.length ? calibratedStaff.waiters : competitionStaff.waiters}
        salesMetric={salesMetric}
        attachment={attachment}
        menuEngineering={menuEngineering}
        timeShift={timeShift}
        heat={heat}
      />
    </motion.div>
  );
}
