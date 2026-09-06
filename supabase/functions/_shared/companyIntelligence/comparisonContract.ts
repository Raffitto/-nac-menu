/** Keep in lockstep with src/intelligence/askNac/coverage/comparisonContract.js */

export function numericOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function percentChange(current: unknown, previous: unknown) {
  const cur = numericOrNull(current);
  const prev = numericOrNull(previous);
  if (cur == null || prev == null) return { value: null as number | null, reason: "missing_value" };
  if (prev === 0) return { value: null as number | null, reason: "zero_denominator" };
  return { value: ((cur - prev) / prev) * 100, reason: null as string | null };
}

export function buildComparisonStatement(input: {
  currentLabel?: string | null;
  currentValue?: unknown;
  previousLabel?: string | null;
  previousValue?: unknown;
  currentCoverageStatus?: string | null;
  previousCoverageStatus?: string | null;
  weekdayMismatch?: boolean;
  dateOfMonthCompare?: boolean;
}) {
  const current = numericOrNull(input.currentValue);
  const previous = numericOrNull(input.previousValue);
  const abs = current != null && previous != null ? current - previous : null;
  const pct = percentChange(current, previous);
  const caveats: string[] = [];
  if (input.currentCoverageStatus === "PARTIAL" || input.previousCoverageStatus === "PARTIAL") {
    caveats.push("One or both periods have partial source coverage.");
  }
  if (current == null) caveats.push("Current-period value is unavailable — not a verified zero.");
  if (previous == null) caveats.push("Comparison-period value is unavailable — not a verified zero.");
  if (pct.reason === "zero_denominator") {
    caveats.push("Percentage change is not meaningful because the comparison period is a verified zero.");
  }
  if (input.weekdayMismatch && input.dateOfMonthCompare) {
    caveats.push("Weekday mix differs, which is expected for a date-of-month comparison.");
  } else if (input.weekdayMismatch) {
    caveats.push("Weekday composition differs; treat as context, not a failed compare.");
  }

  const lines: string[] = [];
  if (input.currentLabel) lines.push(`${input.currentLabel}: ${current == null ? "unavailable" : `${current} SAR`}`);
  if (input.previousLabel) lines.push(`${input.previousLabel}: ${previous == null ? "unavailable" : `${previous} SAR`}`);
  if (abs != null) {
    const signed = abs > 0 ? `+${abs}` : String(abs);
    const pctText = pct.value == null
      ? "percentage change unavailable"
      : `${pct.value > 0 ? "+" : ""}${Number(pct.value.toFixed(1))}%`;
    lines.push(`Change: ${signed} SAR (${pctText})`);
  }
  lines.push(...caveats);
  return {
    currentValue: current,
    previousValue: previous,
    absoluteChange: abs,
    percentChange: pct.value,
    text: lines.join(" "),
  };
}

export function isDateOfMonthMirror(
  current?: { startDate?: string; endDate?: string } | null,
  previous?: { startDate?: string; endDate?: string } | null,
) {
  if (!current?.startDate || !current?.endDate || !previous?.startDate || !previous?.endDate) return false;
  return current.startDate.slice(8) === previous.startDate.slice(8)
    && current.endDate.slice(8) === previous.endDate.slice(8)
    && current.startDate.slice(5, 7) !== previous.startDate.slice(5, 7);
}
