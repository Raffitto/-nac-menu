/**
 * Deterministic comparison statement. Both periods must appear.
 * 0 is a verified zero. Missing stays missing. No % when prior is 0.
 */

export function numericOrNull(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function percentChange(current, previous) {
  const cur = numericOrNull(current);
  const prev = numericOrNull(previous);
  if (cur == null || prev == null) return { value: null, reason: "missing_value" };
  if (prev === 0) return { value: null, reason: "zero_denominator" };
  return { value: ((cur - prev) / prev) * 100, reason: null };
}

export function buildComparisonStatement({
  currentLabel,
  currentValue,
  previousLabel,
  previousValue,
  currentCoverageStatus = null,
  previousCoverageStatus = null,
  weekdayMismatch = false,
  dateOfMonthCompare = false,
} = {}) {
  const current = numericOrNull(currentValue);
  const previous = numericOrNull(previousValue);
  const abs = current != null && previous != null ? current - previous : null;
  const pct = percentChange(current, previous);
  const caveats = [];
  if (currentCoverageStatus === "PARTIAL" || previousCoverageStatus === "PARTIAL") {
    caveats.push("One or both periods have partial source coverage.");
  }
  if (current == null) caveats.push("Current-period value is unavailable — not a verified zero.");
  if (previous == null) caveats.push("Comparison-period value is unavailable — not a verified zero.");
  if (pct.reason === "zero_denominator") {
    caveats.push("Percentage change is not meaningful because the comparison period is a verified zero.");
  }
  if (weekdayMismatch && dateOfMonthCompare) {
    caveats.push("Weekday mix differs, which is expected for a date-of-month comparison.");
  } else if (weekdayMismatch) {
    caveats.push("Weekday composition differs; treat as context, not a failed compare.");
  }

  const lines = [];
  if (currentLabel) lines.push(`${currentLabel}: ${current == null ? "unavailable" : `${current} SAR`}`);
  if (previousLabel) lines.push(`${previousLabel}: ${previous == null ? "unavailable" : `${previous} SAR`}`);
  if (abs != null) {
    const signed = abs > 0 ? `+${abs}` : String(abs);
    const pctText = pct.value == null
      ? "percentage change unavailable"
      : `${pct.value > 0 ? "+" : ""}${Number(pct.value.toFixed(1))}%`;
    lines.push(`Change: ${signed} SAR (${pctText})`);
  }
  lines.push(...caveats);

  return {
    currentLabel: currentLabel || null,
    currentValue: current,
    previousLabel: previousLabel || null,
    previousValue: previous,
    absoluteChange: abs,
    percentChange: pct.value,
    percentChangeReason: pct.reason,
    caveats,
    text: lines.join(" "),
  };
}

export function isDateOfMonthMirror(current, previous) {
  if (!current?.startDate || !current?.endDate || !previous?.startDate || !previous?.endDate) return false;
  const sameDays = current.startDate.slice(8) === previous.startDate.slice(8)
    && current.endDate.slice(8) === previous.endDate.slice(8);
  const differentMonth = current.startDate.slice(5, 7) !== previous.startDate.slice(5, 7);
  return sameDays && differentMonth;
}
