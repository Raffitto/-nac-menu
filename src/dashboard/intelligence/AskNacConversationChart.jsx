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

function formatTick(date) {
  if (!date) return "";
  const parts = String(date).split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return String(date);
}

function formatValue(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${formatted} ${unit}` : formatted;
}

export default function AskNacConversationChart({ chart }) {
  if (!chart?.points?.length) return null;

  return (
    <div className="nac-ask-nac-conversation-chart" data-testid="ask-nac-conversation-chart">
      <h4>{chart.metricLabel} by day</h4>
      <div className="nac-ask-nac-conversation-chart__wrap">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chart.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatTick} fontSize={11} />
            <YAxis
              fontSize={11}
              tickFormatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            />
            <Tooltip
              formatter={(value) => formatValue(value, chart.unit)}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Bar dataKey="value" fill="#c9a227" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
