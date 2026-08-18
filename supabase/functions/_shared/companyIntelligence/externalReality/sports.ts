import type { DateRange, IsoDate } from "../types.ts";
import { overlapRatio, weekendDates } from "./alignment.ts";
import { enumerateInclusiveDates } from "../businessCalendar.ts";
import { factId, getExternalFact, upsertExternalFact } from "./store.ts";
import type { ExternalContextFact, NormalizedExternalEvent } from "./types.ts";

const SEEDED_SPORTS: NormalizedExternalEvent[] = [
  {
    eventType: "football_tournament",
    title: "FIFA World Cup 2026",
    startAt: "2026-06-11",
    endAt: "2026-07-19",
    location: "USA / Mexico / Canada (broadcast demand)",
    importance: "global",
    teams: ["FIFA World Cup"],
    source: "FIFA published tournament window",
    provenance: "seeded_static_sports_calendar",
  },
  {
    eventType: "football_tournament",
    title: "AFC Asian Cup 2023 (Qatar) — historical reference only",
    startAt: "2024-01-12",
    endAt: "2024-02-10",
    location: "Qatar",
    importance: "regional",
    teams: ["AFC"],
    source: "AFC published tournament window",
    provenance: "seeded_static_sports_calendar",
  },
];

export function sportsOverlapping(range: DateRange): Array<NormalizedExternalEvent & { overlap: number }> {
  return SEEDED_SPORTS
    .map((e) => ({ ...e, overlap: overlapRatio(range.startDate, range.endDate, e.startAt, e.endAt) }))
    .filter((e) => e.overlap > 0);
}

export function sportsWeekendOverlap(range: DateRange): { weekendDays: IsoDate[]; overlappingWeekendDays: IsoDate[] } {
  const weekends = weekendDates(enumerateInclusiveDates(range.startDate, range.endDate));
  const events = sportsOverlapping(range);
  const overlappingWeekendDays = weekends.filter((d) =>
    events.some((e) => d >= e.startAt && d <= e.endAt)
  );
  return { weekendDays: weekends, overlappingWeekendDays };
}

export function rememberSportsFacts(branchId: string | null, range: DateRange): ExternalContextFact[] {
  const now = new Date().toISOString();
  const hits = sportsOverlapping(range);
  if (!hits.length) {
    const id = factId(["sports", "none", range.startDate, range.endDate, branchId]);
    const existing = getExternalFact(id);
    if (existing) return [existing];
    return [upsertExternalFact({
      id,
      branchId,
      locationLabel: null,
      type: "sports_events",
      startAt: range.startDate,
      endAt: range.endDate,
      metricOrEvent: "no_major_football_window",
      value: 0,
      units: "overlap_ratio",
      source: "seeded_static_sports_calendar",
      sourceUrl: "https://www.fifa.com/",
      fetchedAt: now,
      immutableHistorical: true,
      quality: "high",
      metadata: { rejected: true },
    }).fact];
  }
  return hits.map((e) => {
    const id = factId(["sports", e.title, e.startAt, e.endAt, branchId]);
    const existing = getExternalFact(id);
    if (existing) return existing;
    return upsertExternalFact({
      id,
      branchId,
      locationLabel: e.location,
      type: "sports_events",
      startAt: e.startAt,
      endAt: e.endAt,
      metricOrEvent: e.title,
      value: e.overlap,
      units: "overlap_ratio",
      source: e.source,
      sourceUrl: "https://www.fifa.com/",
      fetchedAt: now,
      immutableHistorical: true,
      quality: "high",
      metadata: { ...e },
    }).fact;
  });
}
