import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "rgba(10,10,10,0.88)",
  border: "1px solid rgba(143,122,87,0.3)",
  borderRadius: "14px",
  color: "#f9f9f7",
  fontSize: "12px",
};

/** Lazy-loaded recharts bar chart — kept out of Overview Tier-1 cold path. */
export default function HourlyScanChart({
  hourlyData = [],
  usesQrEventsOnly = false,
  emptyReason = "",
}) {
  if (!usesQrEventsOnly) {
    return (
      <div
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(249,249,247,0.4)",
          padding: 16,
          textAlign: "center",
        }}
      >
        {emptyReason || "Hourly scan breakdown isn't available for this period yet."}
      </div>
    );
  }
  if (!hourlyData.length) {
    return (
      <div
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(249,249,247,0.4)",
        }}
      >
        No menu QR scans in range
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={hourlyData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fill: "rgba(249,249,247,0.45)", fontSize: 11 }} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#d7bc8a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
