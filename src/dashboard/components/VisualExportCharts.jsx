import React, { forwardRef } from "react";
import { OperationalVisualExportCharts } from "./OperationalVisualCharts";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";

const BG = "#0c0c0e";

/**
 * Off-screen chart bundle captured via html2canvas for executive PDF.
 */
const VisualExportCharts = forwardRef(function VisualExportCharts(
  { waiters = [], salesMetric = "gross", attachment, menuEngineering = [], timeShift, heat },
  ref,
) {
  const waiterBars = (waiters || []).map((w) => ({
    name: w.waiter?.length > 10 ? `${w.waiter.slice(0, 9)}…` : w.waiter,
    revenue: Number(w.gross_sales) > 0 ? w.gross_sales : w.net_sales,
    modifier: w.modifierAttachPct,
  }));

  const attachBars = (attachment?.topAttachments || []).slice(0, 6).map((p) => ({
    label: p.label?.length > 18 ? `${p.label.slice(0, 16)}…` : p.label,
    rate: p.attachmentRate,
    expected: p.expectedPct,
  }));

  const missedBars = (attachment?.missedUpsells || []).slice(0, 5).map((m) => ({
    label: m.label?.length > 16 ? `${m.label.slice(0, 14)}…` : m.label,
    gap: m.gap || 0,
  }));

  const scatter = (menuEngineering || []).slice(0, 20).map((m) => ({
    popularity: m.popularity,
    profitability: m.profitability,
    quadrant: m.quadrant,
  }));

  const hourly = (timeShift?.hourlyMenu || []).slice(0, 14).map((h) => ({
    label: String(h.hour ?? ""),
    menu: h.menuEvents,
    sales: (timeShift?.hourlySales || []).find((s) => s.hour === h.hour)?.salesQty || 0,
  }));

  const heatBars = (heat?.hotNow || heat?.items || []).slice(0, 8).map((h) => ({
    name: h.item_name?.length > 14 ? `${h.item_name.slice(0, 12)}…` : h.item_name,
    heat: h.heatIndex,
  }));

  const chartBox = {
    width: 520,
    height: 220,
    background: BG,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  };

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        left: -9999,
        top: 0,
        width: 540,
        pointerEvents: "none",
        opacity: 1,
        zIndex: -1,
      }}
    >
      {waiterBars.length > 0 && (
        <div data-export-chart="waiterRevenue" style={chartBox}>
          <p style={{ color: "#d7bc8a", fontSize: 11, margin: "0 0 6px" }}>Waiter revenue</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={waiterBars} layout="vertical">
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" tick={{ fill: "#aaa", fontSize: 9 }} />
              <YAxis type="category" dataKey="name" width={72} tick={{ fill: "#ccc", fontSize: 9 }} />
              <Bar dataKey="revenue" fill="#4ecdc4" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {attachBars.length > 0 && (
        <div data-export-chart="attachment" style={chartBox}>
          <p style={{ color: "#d7bc8a", fontSize: 11, margin: "0 0 6px" }}>Attachment rates</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={attachBars}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: "#aaa", fontSize: 8 }} />
              <YAxis tick={{ fill: "#aaa", fontSize: 9 }} />
              <Bar dataKey="rate" fill="#4ecdc4" name="Actual %" />
              <Bar dataKey="expected" fill="#8F7A5F" name="Target %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {missedBars.length > 0 && (
        <div data-export-chart="missedUpsell" style={chartBox}>
          <p style={{ color: "#f5a623", fontSize: 11, margin: "0 0 6px" }}>Missed upsell gap</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={missedBars}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: "#aaa", fontSize: 8 }} />
              <YAxis tick={{ fill: "#aaa", fontSize: 9 }} />
              <Bar dataKey="gap" fill="#e85d4c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {scatter.length > 0 && (
        <div data-export-chart="menuScatter" style={chartBox}>
          <p style={{ color: "#d7bc8a", fontSize: 11, margin: "0 0 6px" }}>Menu engineering</p>
          <ResponsiveContainer width="100%" height={180}>
            <ScatterChart>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" dataKey="popularity" tick={{ fill: "#aaa", fontSize: 9 }} />
              <YAxis type="number" dataKey="profitability" tick={{ fill: "#aaa", fontSize: 9 }} />
              <Scatter data={scatter}>
                {scatter.map((p, i) => (
                  <Cell
                    key={i}
                    fill={
                      p.quadrant === "Star"
                        ? "#4ecdc4"
                        : p.quadrant === "Puzzle"
                          ? "#f5a623"
                          : p.quadrant === "Workhorse"
                            ? "#8F7A5F"
                            : "#666"
                    }
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {hourly.length > 0 && (
        <div data-export-chart="hourlySales" style={chartBox}>
          <p style={{ color: "#d7bc8a", fontSize: 11, margin: "0 0 6px" }}>Hourly activity</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={hourly}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: "#aaa", fontSize: 9 }} />
              <YAxis tick={{ fill: "#aaa", fontSize: 9 }} />
              <Area type="monotone" dataKey="sales" stroke="#4ecdc4" fill="rgba(78,205,196,0.25)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <OperationalVisualExportCharts waiters={waiters} salesMetric={salesMetric} />

      {heatBars.length > 0 && (
        <div data-export-chart="heatScore" style={chartBox}>
          <p style={{ color: "#d7bc8a", fontSize: 11, margin: "0 0 6px" }}>Heat score</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={heatBars} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={80} tick={{ fill: "#ccc", fontSize: 9 }} />
              <Bar dataKey="heat" fill="#8F7A5F" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});

export default VisualExportCharts;
