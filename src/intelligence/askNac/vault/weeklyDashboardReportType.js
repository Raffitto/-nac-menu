/**
 * Infer weekly_dashboard report type from Drive folder/file paths and names.
 */
export function inferWeeklyDashboardReportType(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) return null;
  if (
    /\bweekly dashboards?\b/i.test(normalized)
    || /\bexecutive reports?\b.*\bweekly\b/i.test(normalized)
    || /\bweekly\b.*\bexecutive reports?\b/i.test(normalized)
    || /\bnac[\s-]?weekly[\s-]?dashboard\b/i.test(normalized)
  ) {
    return "weekly_dashboard";
  }
  return null;
}

export function resolveDriveReportTypeFromPath(text = "", fallback = "other") {
  if (/\bcash[\s-]?up|cashup|daily cash report|monthly cash safe\b/i.test(text)) return "cash_up";
  const weeklyDashboard = inferWeeklyDashboardReportType(text);
  if (weeklyDashboard) return weeklyDashboard;
  return fallback || "other";
}
