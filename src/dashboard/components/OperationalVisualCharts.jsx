import React from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ReferenceLine,
  LabelList,
} from "recharts";
import {
  buildOperationalVisualBundle,
  shiftColor,
  shiftLabel,
} from "../engines/waiterVisualEngine";
import { EXECUTIVE_LABELS, SEMANTIC } from "../config/executiveVisualLanguage";

const TOOLTIP = {
  background: "rgba(8,8,10,0.94)",
  border: "1px solid rgba(215,188,138,0.22)",
  borderRadius: 10,
  color: "#f9f9f7",
  fontSize: 11,
};

const BEV_COLORS = {
  low: "#8a3028",
  standard: "#5c5348",
  premium: "#4ecdc4",
};

function ExportShell({ chartId, title, height = 240, children }) {
  return (
    <div
      data-export-chart={chartId}
      className="vi-export-chart-shell"
      style={{ width: 520, height, background: "#0c0c0e", borderRadius: 12, padding: 12 }}
    >
      {title && <p className="vi-export-chart-title">{title}</p>}
      {children}
    </div>
  );
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP}>
      <strong>{d.waiter}</strong>
      <div style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}>
        {EXECUTIVE_LABELS.grossSales} {Math.round(d.gross).toLocaleString()} SAR · {EXECUTIVE_LABELS.revenueQuality}{" "}
        {d.rq}/100
        <br />
        {EXECUTIVE_LABELS.avgTicket} {Math.round(d.avgCheck)} SAR · {d.shiftLabel}
        {d.scatterCallout && (
          <>
            <br />
            <span style={{ color: SEMANTIC.gold }}>{d.scatterCallout}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function RevenueQualityScatter({ data, height = 280, compact = false }) {
  if (!data?.length) return null;
  return (
    <div className={`vi-chart-wrap vi-chart-wrap--scatter ${compact ? "vi-chart-wrap--compact" : ""}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 28, right: 24, bottom: compact ? 12 : 28, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          {(data[0]?.midGross ?? 0) > 0 && (
            <ReferenceLine x={data[0].midGross} stroke="rgba(215,188,138,0.35)" strokeDasharray="5 5" />
          )}
          <ReferenceLine y={data[0]?.midRq ?? 52} stroke="rgba(78,205,196,0.35)" strokeDasharray="5 5" />
          <XAxis
            type="number"
            dataKey="gross"
            name="Gross"
            tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 10 }}
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            label={
              compact
                ? undefined
                : { value: "Gross sales (SAR)", position: "bottom", fill: "rgba(249,249,247,0.35)", fontSize: 10 }
            }
          />
          <YAxis
            type="number"
            dataKey="rq"
            name="RQ"
            domain={[0, 100]}
            tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 10 }}
            label={
              compact
                ? undefined
                : { value: "Revenue quality", angle: -90, position: "insideLeft", fill: "rgba(249,249,247,0.35)", fontSize: 10 }
            }
          />
          <ZAxis type="number" dataKey="z" range={[70, 380]} />
          <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "4 4", stroke: "rgba(215,188,138,0.35)" }} />
          <Scatter data={data} name="Waiters">
            {data.map((entry) => (
              <Cell key={entry.waiter} fill={entry.fill} fillOpacity={0.9} stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
            ))}
            <LabelList dataKey="waiter" position="right" offset={6} fill="rgba(249,249,247,0.85)" fontSize={9} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="vi-scatter-legend">
        {["breakfast", "pm", "balanced"].map((s) => (
          <span key={s} className="vi-scatter-legend-item">
            <span className="vi-scatter-dot" style={{ background: shiftColor(s) }} />
            {shiftLabel(s)}
          </span>
        ))}
        <span className="vi-scatter-legend-hint">Bubble size = average ticket</span>
      </div>
      {!compact && (
        <div className="vi-scatter-callouts">
          {data
            .filter((p) => p.scatterCallout)
            .slice(0, 3)
            .map((p) => (
              <span key={p.waiter} className="vi-scatter-callout-chip">
                <strong>{p.waiter}</strong> — {p.scatterCallout}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export function WaiterGroupedPerformance({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="vi-grouped-bars">
      {rows.map((row) => (
        <div key={row.waiter} className="vi-grouped-row">
          <div className="vi-grouped-name">
            <span className="vi-grouped-rank">#{row.rank}</span> {row.shortName}
            {row.archetype && <span className={`vi-archetype vi-archetype--${row.archetype.tone}`}>{row.archetype.label}</span>}
          </div>
          <div className="vi-grouped-metrics">
            {row.bars.map((b) => (
              <div key={b.key} className="vi-grouped-metric">
                <div className="vi-grouped-metric-head">
                  <span>{b.label}</span>
                  <span className="vi-grouped-raw">{b.display}</span>
                </div>
                <div className="vi-bar-track vi-bar-track--thin">
                  <div
                    className={`vi-bar-fill ${b.tone === "critical" ? "critical" : b.tone === "warn" ? "warn" : "good"}`}
                    style={{ width: `${b.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WaiterOperationalRadar({ radar }) {
  if (!radar?.axes?.length) return null;
  return (
    <div className="vi-chart-wrap vi-chart-wrap--radar" style={{ height: 300 }}>
      <p className="vi-radar-title">
        {radar.waiter}
        <span className="vi-radar-shift">{radar.shiftLabel}</span>
      </p>
      <ResponsiveContainer width="100%" height="88%">
        <RadarChart data={radar.axes} cx="50%" cy="52%" outerRadius="72%">
          <PolarGrid stroke="rgba(255,255,255,0.08)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "rgba(249,249,247,0.55)", fontSize: 9 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "rgba(249,249,247,0.3)", fontSize: 8 }} />
          <Radar name={radar.waiter} dataKey="value" stroke="#d7bc8a" fill="#4ecdc4" fillOpacity={0.22} strokeWidth={1.5} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BeverageMixStackedChart({ rows, height = 260 }) {
  if (!rows?.length) return null;
  const chartData = rows.map((r) => ({
    name: r.shortName,
    Low: r.low / 100,
    Standard: r.standard / 100,
    Premium: r.premium / 100,
    waiter: r.waiter,
  }));

  return (
    <div className="vi-chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }} stackOffset="expand">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "rgba(249,249,247,0.4)", fontSize: 9 }}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            domain={[0, 1]}
          />
          <YAxis type="category" dataKey="name" width={76} tick={{ fill: "rgba(249,249,247,0.55)", fontSize: 9 }} />
          <Tooltip
            contentStyle={TOOLTIP}
            formatter={(val, name, props) => {
              const row = rows.find((r) => r.shortName === props.payload.name);
              if (!row) return [`${Math.round(val * 100)}%`, name];
              const map = { Low: row.low, Standard: row.standard, Premium: row.premium };
              return [`${map[name] ?? Math.round(val * 100)}%`, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10, color: "rgba(249,249,247,0.6)" }} />
          <Bar dataKey="Low" stackId="a" fill={BEV_COLORS.low} />
          <Bar dataKey="Standard" stackId="a" fill={BEV_COLORS.standard} />
          <Bar dataKey="Premium" stackId="a" fill={BEV_COLORS.premium} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PremiumBevLeaderboard({ rows }) {
  if (!rows?.length) return null;
  const max = rows[0]?.premiumPct || 1;
  return (
    <div className="vi-leaderboard">
      {rows.map((r, i) => (
        <div key={r.waiter} className="vi-leaderboard-row">
          <span className="vi-leaderboard-rank">{i + 1}</span>
          <span className="vi-leaderboard-name">{r.waiter}</span>
          <div className="vi-leaderboard-bar-wrap">
            <div className="vi-bar-track vi-bar-track--thin">
              <div className="vi-bar-fill good" style={{ width: `${(r.premiumPct / max) * 100}%` }} />
            </div>
          </div>
          <span className="vi-leaderboard-val">{r.premiumPct}%</span>
          <span className="vi-leaderboard-sub">{Math.round(r.premiumGross).toLocaleString()} SAR</span>
        </div>
      ))}
    </div>
  );
}

export function BeverageOpportunityPanel({ opportunity }) {
  if (!opportunity) return null;
  return (
    <div className="vi-opp-panel">
      <p className="vi-opp-label">Estimated premium beverage opportunity</p>
      <p className="vi-opp-value">{Math.round(opportunity.teamTotal || 0).toLocaleString()} SAR</p>
      <p className="vi-opp-note">{opportunity.methodology}</p>
      {opportunity.byWaiter?.length > 0 && (
        <div className="vi-opp-breakdown">
          {opportunity.byWaiter.slice(0, 4).map((w) => (
            <div key={w.waiter} className="vi-opp-row">
              <span>{w.waiter}</span>
              <span>~{w.estimate.toLocaleString()} SAR</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WaiterComparisonDashboard({ waiters, salesMetric = "gross" }) {
  const bundle = React.useMemo(() => buildOperationalVisualBundle(waiters, salesMetric), [waiters, salesMetric]);
  const [radarWaiter, setRadarWaiter] = React.useState(null);

  React.useEffect(() => {
    if (bundle.defaultRadarWaiter && !radarWaiter) {
      setRadarWaiter(bundle.defaultRadarWaiter.waiter);
    }
  }, [bundle.defaultRadarWaiter, radarWaiter]);

  const selected = waiters.find((w) => w.waiter === radarWaiter) || bundle.defaultRadarWaiter;
  const radar = bundle.radarFor(selected);

  if (!waiters?.length) {
    return <p className="nac-empty-state">Upload waiter sales to activate operational comparison</p>;
  }

  return (
    <div className="vi-op-dashboard">
      <div className="vi-kpi-strip">
        <div className="vi-kpi vi-kpi--compact">
          <p className="vi-kpi-label">Quality leader</p>
          <p className="vi-kpi-value">{bundle.defaultRadarWaiter?.waiter || "—"}</p>
        </div>
        <div className="vi-kpi vi-kpi--compact">
          <p className="vi-kpi-label">{EXECUTIVE_LABELS.revenueQuality} leader</p>
          <p className="vi-kpi-value">{bundle.defaultRadarWaiter?.revenueQualityScore ?? "—"}/100</p>
        </div>
        <div className="vi-kpi vi-kpi--compact">
          <p className="vi-kpi-label">Soft drink-heavy profiles</p>
          <p className="vi-kpi-value">{waiters.filter((w) => (w.ops?.lowValueBevPct || 0) >= 52).length}</p>
        </div>
      </div>

      <div className="vi-grid-2 vi-op-grid">
        <div className="vi-panel">
          <h3>Revenue quality vs gross</h3>
          <p className="vi-subtitle">High volume + low RQ = margin risk · bubble = avg ticket · color = shift</p>
          <RevenueQualityScatter data={bundle.scatter} />
        </div>

        <div className="vi-panel">
          <h3>Operational radar</h3>
          <p className="vi-subtitle">Strengths vs gaps — normalized to floor benchmarks</p>
          <select
            className="vi-waiter-select"
            value={radarWaiter || ""}
            onChange={(e) => setRadarWaiter(e.target.value)}
            aria-label="Select waiter for radar"
          >
            {waiters.map((w) => (
              <option key={w.waiter} value={w.waiter}>
                {w.waiter}
              </option>
            ))}
          </select>
          <WaiterOperationalRadar radar={radar} />
        </div>
      </div>

      <div className="vi-panel" style={{ marginTop: "1rem" }}>
        <h3>Grouped performance</h3>
        <p className="vi-subtitle">Bars normalized for comparison — values shown at right</p>
        <WaiterGroupedPerformance rows={bundle.grouped} />
      </div>
    </div>
  );
}

export function BeverageMixIntelligence({ waiters }) {
  const bundle = React.useMemo(() => buildOperationalVisualBundle(waiters), [waiters]);

  if (!waiters?.length) {
    return <p className="nac-empty-state">Upload waiter sales for beverage quality analytics</p>;
  }

  return (
    <div className="vi-bev-dashboard">
      <div className="vi-grid-2">
        <div className="vi-panel">
          <h3>Beverage mix by waiter</h3>
          <p className="vi-subtitle">% of drink revenue — low-value vs standard vs premium</p>
          <BeverageMixStackedChart rows={bundle.beverageStack} />
        </div>

        <div className="vi-panel">
          <h3>Premium beverage leaderboard</h3>
          <p className="vi-subtitle">Ranked by premium drink % of beverage revenue — not quantity</p>
          <PremiumBevLeaderboard rows={bundle.premiumLeaderboard} />
          <BeverageOpportunityPanel opportunity={bundle.opportunity} />
        </div>
      </div>
    </div>
  );
}

export function OperationalVisualExportCharts({ waiters, salesMetric = "gross" }) {
  const bundle = React.useMemo(() => buildOperationalVisualBundle(waiters, salesMetric), [waiters, salesMetric]);
  const radar = bundle.radarFor(bundle.defaultRadarWaiter);

  if (!waiters?.length) return null;

  const boxH = 228;

  return (
    <>
      <ExportShell chartId="rqScatter" title="Revenue quality vs gross sales" height={boxH}>
        <RevenueQualityScatter data={bundle.scatter} height={190} compact />
      </ExportShell>

      <ExportShell chartId="bevMixStacked" title="Beverage quality mix (%)" height={boxH + 40}>
        <BeverageMixStackedChart rows={bundle.beverageStack} height={240} />
      </ExportShell>

      <ExportShell chartId="premBevLeaderboard" title="Premium beverage mix rank" height={boxH + 20}>
        <PremiumBevLeaderboard rows={bundle.premiumLeaderboard.slice(0, 8)} />
      </ExportShell>

      <ExportShell chartId="waiterRadar" title={`Operational profile — ${radar.waiter}`} height={boxH + 20}>
        <WaiterOperationalRadar radar={radar} />
      </ExportShell>

      <div
        data-export-chart="waiterGrouped"
        className="vi-export-chart-shell"
        style={{ width: 520, background: "#0c0c0e", borderRadius: 12, padding: 12 }}
      >
        <p className="vi-export-chart-title">Grouped waiter performance</p>
        <WaiterGroupedPerformance rows={bundle.grouped.slice(0, 9)} />
      </div>

      <div
        data-export-chart="bevOpportunity"
        className="vi-export-chart-shell"
        style={{ width: 520, background: "#0c0c0e", borderRadius: 12, padding: 16 }}
      >
        <p className="vi-export-chart-title">Premium beverage opportunity</p>
        <BeverageOpportunityPanel opportunity={bundle.opportunity} />
      </div>
    </>
  );
}
