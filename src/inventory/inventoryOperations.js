export function filterCountTotals(totals = [], filter = "all") {
  if (filter === "uncounted") {
    return totals.filter(({ has_uncounted_location: uncounted }) => uncounted);
  }
  if (filter === "warnings") {
    return totals.filter(({ has_warning: warning }) => warning);
  }
  if (filter === "high-value") {
    return totals.filter(({ variance_value: value }) => Math.abs(Number(value || 0)) >= 100);
  }
  if (filter === "high-percentage") {
    return totals.filter(({ variance_quantity: variance, expected_quantity: expected }) => (
      Math.abs(Number(variance || 0)) / Math.max(Math.abs(Number(expected || 0)), 0.000001)
    ) >= 0.1);
  }
  if (filter === "unresolved-units") {
    return totals.filter(({ has_unresolved_unit: unresolved }) => unresolved);
  }
  return totals;
}
