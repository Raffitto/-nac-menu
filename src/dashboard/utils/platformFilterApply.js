/**
 * Client-side filters aligned with PlatformFiltersContext.
 * Used after Supabase fetch for review_events / menu_events rows.
 */

const RIYADH_TZ = "Asia/Riyadh";

export function shiftFromTimestamp(iso) {
  if (!iso) return "am";
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: RIYADH_TZ,
        hour: "numeric",
        hour12: false,
      }).format(new Date(iso)),
    );
    if (hour >= 5 && hour < 12) return "am";
    if (hour >= 12 && hour < 17) return "pm";
    return "late";
  } catch {
    return "am";
  }
}

export function isWeekendInRiyadh(iso) {
  if (!iso) return false;
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: RIYADH_TZ,
      weekday: "short",
    }).format(new Date(iso));
    return weekday === "Fri" || weekday === "Sat";
  } catch {
    return false;
  }
}

function normalizeRole(role) {
  const r = (role || "").toString().toLowerCase();
  if (r.includes("recept")) return "receptionist";
  if (r.includes("wait")) return "waiter";
  if (r.includes("manager") || r === "rm") return "rm";
  return r;
}

function rowLanguage(row) {
  const lang =
    row.language ||
    row.metadata?.language ||
    row.metadata?.lang ||
  "";
  return lang.toString().toLowerCase().slice(0, 2);
}

/**
 * @param {object} row - review_events or menu_events row
 * @param {object} filters - platform filter state (optional fields)
 */
export function matchesPlatformFilters(row, filters) {
  if (!filters) return true;

  if (filters.branch && row.branch_id && row.branch_id !== filters.branch) {
    return false;
  }

  if (filters.language && filters.language !== "all") {
    const lang = rowLanguage(row);
    if (lang && lang !== filters.language) return false;
  }

  if (filters.eventType && filters.eventType !== "all") {
    if ((row.event_type || "") !== filters.eventType) return false;
  }

  if (filters.shift && filters.shift !== "all") {
    if (shiftFromTimestamp(row.created_at) !== filters.shift) return false;
  }

  if (filters.dayType && filters.dayType !== "all") {
    const weekend = isWeekendInRiyadh(row.created_at);
    if (filters.dayType === "weekend" && !weekend) return false;
    if (filters.dayType === "weekday" && weekend) return false;
  }

  if (filters.role && filters.role !== "all") {
    const rawRole =
      row.employee_role ||
      row.metadata?.employee_role ||
      row.metadata?.role ||
      null;
    const role = normalizeRole(rawRole);
    if (role && role !== filters.role) return false;
  }

  return true;
}

export function applyPlatformFilters(rows, filters) {
  if (!filters || !Array.isArray(rows)) return rows || [];
  return rows.filter((row) => matchesPlatformFilters(row, filters));
}

/** Stable dependency key for React hooks (avoids spread in deps arrays). */
export function filtersKey(filters) {
  if (!filters) return "";
  return [
    filters.branch,
    filters.selectedRange,
    filters.timeRangeHours,
    filters.language,
    filters.shift,
    filters.eventType,
    filters.dayType,
    filters.role,
  ].join("|");
}
