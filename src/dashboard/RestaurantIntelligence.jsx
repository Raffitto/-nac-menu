import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Loader2,
  ChevronDown,
  Download,
  FileText,
  Zap,
  Star,
  AlertTriangle,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { getFoodicsIntelligenceContext } from "../lib/foodicsApi";
import { buildRestaurantIntelligence } from "./engines/analyticsEngine";
import { classifyMenuItems } from "./engines/menuEngineeringEngine";
import { buildForecasts } from "./engines/forecastingEngine";
import { buildRecommendations, buildManagementBriefing } from "./engines/recommendationEngine";
import {
  hourlyChartSeries,
  categoryChartSeries,
  conversionChartSeries,
} from "./engines/chartEngine";
import { businessDayExportNote } from "./utils/businessDay";
import { DEFAULT_RANGE, RANGE_OPTIONS, rangeToHours, rangeExportLabel } from "./utils/rangeState";
import "./styles/restaurant-intelligence.css";

const TOOLTIP = {
  background: "rgba(10,10,10,0.9)",
  border: "1px solid rgba(143,122,87,0.3)",
  borderRadius: 12,
  color: "#f9f9f7",
  fontSize: 12,
};

export default function RestaurantIntelligence() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [biData, setBiData] = useState(null);
  const [foodics, setFoodics] = useState(null);
  const [mgmtOpen, setMgmtOpen] = useState(true);
  const [deepOpen, setDeepOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState(DEFAULT_RANGE);

  const configured = isSupabaseConfigured();
  const pHours = rangeToHours(selectedRange);

  const load = useCallback(async () => {
    if (!supabase || !configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) {
        setError("Please log in from the Dashboard tab first.");
        setLoading(false);
        return;
      }
      const { data: rpc, error: rpcErr } = await supabase.rpc("get_bi_dashboard", {
        p_branch: null,
        p_hours: pHours,
      });
      if (rpcErr) throw rpcErr;
      setBiData(rpc);
      const fc = await getFoodicsIntelligenceContext(rpc);
      setFoodics(fc);
    } catch (e) {
      setError(e?.message || "Failed to load intelligence");
    } finally {
      setLoading(false);
    }
  }, [configured, pHours]);

  useEffect(() => {
    load();
  }, [load]);

  const intelligence = useMemo(
    () => buildRestaurantIntelligence(biData, foodics),
    [biData, foodics],
  );

  const menuEngineering = useMemo(
    () => classifyMenuItems(intelligence?.funnels || []),
    [intelligence],
  );

  const forecasts = useMemo(
    () => buildForecasts(biData, intelligence, foodics),
    [biData, intelligence, foodics],
  );

  const recommendations = useMemo(
    () => buildRecommendations(intelligence, menuEngineering),
    [intelligence, menuEngineering],
  );

  const briefing = useMemo(
    () => buildManagementBriefing(intelligence, recommendations, forecasts),
    [intelligence, recommendations, forecasts],
  );

  const hourlyChart = useMemo(() => hourlyChartSeries(biData), [biData]);
  const categoryChart = useMemo(() => categoryChartSeries(intelligence?.categoryHealth), [intelligence]);
  const conversionChart = useMemo(() => conversionChartSeries(intelligence?.funnels || []), [intelligence]);
  const exportPayload = useMemo(
    () => ({
      briefing,
      intelligence,
      menuEngineering,
      forecasts,
      kpis: intelligence?.kpis,
      categoryGrades: intelligence?.categoryGrades,
      searchIntel: intelligence?.search?.advanced,
      cannibalization: intelligence?.cannibalization,
      exportMeta: {
        title: `Restaurant Intelligence — ${rangeExportLabel(selectedRange)}`,
        period: rangeExportLabel(selectedRange),
      },
    }),
    [briefing, intelligence, menuEngineering, forecasts, selectedRange],
  );

  const runExport = async (type) => {
    const mod = await import("./engines/exportEngine");
    if (type === "csv") mod.exportIntelligenceCSV(intelligence);
    else if (type === "xlsx") mod.exportExecutiveXLSX(exportPayload);
    else mod.exportExecutivePDF(exportPayload);
  };

  if (!configured) {
    return (
      <motion.div className="ri-page ri-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Brain size={48} />
        <p>Connect Supabase to unlock restaurant intelligence.</p>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <motion.div className="ri-page ri-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Loader2 size={32} className="ri-spin" />
        <p>Building intelligence…</p>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div className="ri-page ri-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <AlertTriangle size={40} />
        <p>{error}</p>
      </motion.div>
    );
  }

  return (
    <motion.div className="ri-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <header className="ri-header">
        <div>
          <Brain size={22} className="ri-icon" />
          <div>
            <h1>Restaurant Intelligence</h1>
            <p>Operating intelligence — simple surface, deep analysis underneath</p>
            {intelligence?.validation && (
              <p className="ri-trust-bar">
                Based on {intelligence.validation.events.toLocaleString()} menu events · {intelligence.validation.sessions.toLocaleString()} sessions
                {intelligence.businessDay?.key && ` · business day ${intelligence.businessDay.key} (3AM–3AM)`}
                {intelligence.visibilityReady === false && " · collecting visibility signals"}
                {intelligence.hasFoodics && " · Foodics linked"}
                {intelligence.foodicsCompared && " · compared to previous import"}
                {intelligence.generated_at && ` · updated ${new Date(intelligence.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              </p>
            )}
          </div>
        </div>
        <div className="ri-header-actions">
          <div className="ri-range-pills">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                title={r.title}
                className={`ri-btn ri-btn-sm ${selectedRange === r.id ? "ri-btn-gold" : ""}`}
                onClick={() => setSelectedRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="ri-export-btns">
            <button type="button" className="ri-btn" onClick={() => runExport("csv")}>
              <Download size={14} /> CSV
            </button>
            <button type="button" className="ri-btn" onClick={() => runExport("xlsx")}>
              <FileText size={14} /> XLSX
            </button>
            <button type="button" className="ri-btn ri-btn-gold" onClick={() => runExport("pdf")}>
              <Download size={14} /> PDF
            </button>
          </div>
        </div>
      </header>

      {/* Management Mode */}
      <section className="ri-mgmt">
        <button type="button" className="ri-mgmt-toggle" onClick={() => setMgmtOpen(!mgmtOpen)}>
          <Zap size={16} />
          Management Mode — 30 second briefing
          <ChevronDown size={14} className={mgmtOpen ? "open" : ""} />
        </button>
        <AnimatePresence>
          {mgmtOpen && briefing && (
            <motion.div className="ri-mgmt-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <motion.div className="ri-mgmt-grid" initial={{ y: 8 }} animate={{ y: 0 }}>
                <BriefBlock title="What is working" items={briefing.working || briefing.strongest} icon={<Star size={14} />} tone="good" />
                <BriefBlock title="Needs attention" items={briefing.needsAttention || briefing.weakest} icon={<AlertTriangle size={14} />} tone="warn" />
                <BriefBlock title="Do today" items={briefing.todayActions} icon={<Zap size={14} />} tone="action" />
                <BriefBlock title="Monitor next" items={briefing.monitor || [briefing.focus]} icon={<TrendingUp size={14} />} tone="neutral" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* KPIs */}
      {intelligence?.kpis && (
        <div className="ri-kpis">
          <KpiCard label="Sessions" value={intelligence.kpis.sessions} />
          <KpiCard label="Impressions" value={intelligence.kpis.impressions} />
          <KpiCard label="QR Today" value={intelligence.kpis.today_qr ?? intelligence.kpis.qr} />
          <KpiCard label="Bounce" value={`${intelligence.kpis.bounce_pct}%`} />
          <KpiCard label="Foodics" value={foodics?.hasImports ? "Linked" : "—"} />
        </div>
      )}

      {/* Quick insights */}
      <div className="ri-cards">
        <InsightStrip title="Visual & discovery sellers" items={intelligence?.funnels?.filter((f) => f.behavior_type === "Visual Seller" || f.behavior_type === "Discovery Seller").slice(0, 3)} field="item_name" />
        <InsightStrip title="Needs attention" items={intelligence?.attention?.menuTraps} field="item_name" />
        <InsightStrip title="Waiter-driven & hidden" items={intelligence?.offlineSellers} field="item_name" />
      </div>

      {/* Charts — minimal (skip heavy render until data ready) */}
      {intelligence && (
      <div className="ri-charts">
        {hourlyChart.length > 0 && (
          <ChartCard title="Hourly activity" note={intelligence?.time?.insight}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourlyChart}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 10 }} />
                <YAxis tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Bar dataKey="count" fill="rgba(78,205,196,0.7)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
        {categoryChart.length > 0 && (
          <ChartCard title="Category health">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryChart}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 10 }} />
                <YAxis tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 10 }} />
                <Tooltip contentStyle={TOOLTIP} />
                <Bar dataKey="opens" fill="rgba(215,188,138,0.75)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>
      )}

      <section className="ri-deep ri-diagnostics">
        <button type="button" className="ri-deep-toggle" onClick={() => setDiagOpen(!diagOpen)}>
          <BarChart3 size={16} />
          Visibility Diagnostics
          <ChevronDown size={14} className={diagOpen ? "open" : ""} />
        </button>
        <AnimatePresence>
          {diagOpen && intelligence?.visibilityDiagnostics && (
            <motion.div className="ri-deep-body ri-diag-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="ri-diag-health">Traffic quality: <strong>{intelligence.visibilityDiagnostics.health}</strong></p>
              <ul className="ri-diag-list">
                {intelligence.visibilityDiagnostics.checks.map((c) => (
                  <li key={c.label} className={c.ok ? "ok" : "warn"}>
                    <span>{c.label}</span>
                    <span>{c.value}</span>
                  </li>
                ))}
              </ul>
              <p className="ri-chart-note">{businessDayExportNote()}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Deep Analysis — collapsed */}
      <section className="ri-deep">
        <button type="button" className="ri-deep-toggle" onClick={() => setDeepOpen(!deepOpen)}>
          <BarChart3 size={16} />
          Deep Analysis
          <ChevronDown size={14} className={deepOpen ? "open" : ""} />
        </button>
        <AnimatePresence>
          {deepOpen && (
            <motion.div className="ri-deep-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {conversionChart.length > 0 && (
                <ChartCard title="Visibility vs sales" note="Impressions vs Foodics orders">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={conversionChart} layout="vertical">
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={100} tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 9 }} />
                      <Tooltip contentStyle={TOOLTIP} />
                      <Bar dataKey="conversion" fill="#4ecdc4" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}

              <div className="ri-quadrants">
                <h3>Menu engineering</h3>
                <motion.div className="ri-quad-grid">
                  {["Star", "Puzzle", "Workhorse", "Dog"].map((q) => (
                    <motion.div key={q} className={`ri-quad-card q-${q.toLowerCase()}`} whileHover={{ y: -2 }}>
                      <span className="ri-quad-label">{q}</span>
                      <ul>
                        {menuEngineering.filter((m) => m.quadrant === q).slice(0, 4).map((m) => (
                          <li key={m.item_name}>{m.item_name}</li>
                        ))}
                      </ul>
                    </motion.div>
                  ))}
                </motion.div>
              </div>

              {intelligence?.categoryGrades?.length > 0 && (
                <motion.div className="ri-forecast">
                  <h3>Category grades</h3>
                  <ul>
                    {intelligence.categoryGrades.slice(0, 6).map((g) => (
                      <li key={g.category_id}><strong>{g.grade}</strong> {g.name} — {g.action}</li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {intelligence?.placement?.insights?.length > 0 && (
                <motion.div className="ri-forecast">
                  <h3>Placement intelligence</h3>
                  <ul>
                    {intelligence.placement.insights.map((p, i) => (
                      <li key={i}>{p.message}</li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {intelligence?.cannibalization?.risks?.length > 0 && (
                <motion.div className="ri-forecast">
                  <h3>Cannibalization risks</h3>
                  <ul>
                    {intelligence.cannibalization.risks.map((r, i) => (
                      <li key={i}>{r.title}: {r.detail}</li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {intelligence?.operational?.signals?.length > 0 && (
                <motion.div className="ri-forecast">
                  <h3>Operational signals</h3>
                  <ul>
                    {intelligence.operational.signals.slice(0, 6).map((s, i) => (
                      <li key={i}>{s.message}</li>
                    ))}
                  </ul>
                </motion.div>
              )}

              {forecasts?.narratives?.length > 0 && (
                <motion.div className="ri-forecast">
                  <h3>Forecast signals</h3>
                  <ul>
                    {forecasts.narratives.map((n, i) => (
                      <li key={i}>{n.message}</li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </motion.div>
  );
}

function KpiCard({ label, value }) {
  return (
    <motion.div className="ri-kpi" whileHover={{ y: -2 }}>
      <span className="ri-kpi-val">{value}</span>
      <span className="ri-kpi-label">{label}</span>
    </motion.div>
  );
}

function BriefBlock({ title, items, icon, tone }) {
  if (!items?.length) return null;
  return (
    <div className={`ri-brief-block tone-${tone}`}>
      <motion.div className="ri-brief-head">{icon}<span>{title}</span></motion.div>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

function InsightStrip({ title, items, field }) {
  if (!items?.length) return null;
  return (
    <motion.div className="ri-strip" whileHover={{ y: -2 }}>
      <h3>{title}</h3>
      <p>{items.slice(0, 3).map((x) => x[field]).join(" · ")}</p>
    </motion.div>
  );
}

function ChartCard({ title, note, children }) {
  return (
    <motion.div className="ri-chart-card" whileHover={{ boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
      <h3>{title}</h3>
      {note && <p className="ri-chart-note">{note}</p>}
      {children}
    </motion.div>
  );
}
