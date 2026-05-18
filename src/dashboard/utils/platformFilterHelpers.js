/** True when language/shift/event/day/role filters require client-side row filtering */
export function hasExtendedPlatformFilters(filters) {
  if (!filters) return false;
  return (
    (filters.language && filters.language !== "all") ||
    (filters.shift && filters.shift !== "all") ||
    (filters.eventType && filters.eventType !== "all") ||
    (filters.dayType && filters.dayType !== "all") ||
    (filters.role && filters.role !== "all")
  );
}
