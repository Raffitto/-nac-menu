import { SEEDED_NAMED_PERIODS } from "../temporalService.ts";
import { HOLIDAY_REGISTRY, foundingDayDateForYear } from "../holidayCalendar.ts";
import type { DateRange, IsoDate } from "../types.ts";
import { overlapRatio } from "./alignment.ts";
import { factId, getExternalFact, upsertExternalFact } from "./store.ts";
import type { ExternalContextFact, NormalizedExternalEvent } from "./types.ts";

type CalendarHit = {
  id: string;
  title: string;
  startAt: IsoDate;
  endAt: IsoDate;
  kind: "public_holiday" | "islamic" | "school";
  source: string;
  quality: "high" | "medium";
};

const SCHOOL_WINDOWS: CalendarHit[] = [
  {
    id: "ksa_summer_2026",
    title: "Typical KSA public-school summer break 2026",
    startAt: "2026-06-26",
    endAt: "2026-08-20",
    kind: "school",
    source: "seeded_typical_moe_academic_window",
    quality: "medium",
  },
  {
    id: "ksa_summer_2025",
    title: "Typical KSA public-school summer break 2025",
    startAt: "2025-06-26",
    endAt: "2025-08-21",
    kind: "school",
    source: "seeded_typical_moe_academic_window",
    quality: "medium",
  },
  {
    id: "ksa_midyear_2025_26",
    title: "Typical KSA mid-year school break 2025/26",
    startAt: "2025-12-18",
    endAt: "2026-01-03",
    kind: "school",
    source: "seeded_typical_moe_academic_window",
    quality: "medium",
  },
];

function nationalDay(year: number): CalendarHit {
  const d = `${year}-09-23` as IsoDate;
  return {
    id: `national_day_${year}`,
    title: `Saudi National Day ${year}`,
    startAt: d,
    endAt: d,
    kind: "public_holiday",
    source: HOLIDAY_REGISTRY.saudi_founding_day.source,
    quality: "high",
  };
}

function foundingDay(year: number): CalendarHit {
  const d = foundingDayDateForYear(year);
  return {
    id: `founding_day_${year}`,
    title: `Saudi Founding Day ${year}`,
    startAt: d,
    endAt: d,
    kind: "public_holiday",
    source: "trusted_ksa_holiday_registry",
    quality: "high",
  };
}

function named(key: string, kind: CalendarHit["kind"]): CalendarHit | null {
  const range = SEEDED_NAMED_PERIODS[key];
  if (!range) return null;
  return {
    id: key,
    title: range.label || key,
    startAt: range.startDate,
    endAt: range.endDate,
    kind,
    source: "nac_temporal_seed",
    quality: "high",
  };
}

export function listCalendarHits(range: DateRange): CalendarHit[] {
  const years = new Set([
    Number(range.startDate.slice(0, 4)),
    Number(range.endDate.slice(0, 4)),
  ]);
  const hits: CalendarHit[] = [...SCHOOL_WINDOWS];
  for (const y of years) {
    hits.push(nationalDay(y), foundingDay(y));
    const ramadan = named(`ramadan:${y}`, "islamic");
    const eidF = named(`eid_al_fitr:${y}`, "islamic");
    if (ramadan) hits.push(ramadan);
    if (eidF) hits.push(eidF);
  }
  // Eid al-Adha approximate published Gregorian windows (seeded, not scraped).
  hits.push({
    id: "eid_al_adha:2026",
    title: "Eid al-Adha 2026 (seeded window)",
    startAt: "2026-05-27",
    endAt: "2026-05-30",
    kind: "islamic",
    source: "nac_temporal_seed_eid_adha",
    quality: "medium",
  });
  hits.push({
    id: "eid_al_adha:2025",
    title: "Eid al-Adha 2025 (seeded window)",
    startAt: "2025-06-06",
    endAt: "2025-06-09",
    kind: "islamic",
    source: "nac_temporal_seed_eid_adha",
    quality: "medium",
  });
  return hits.filter((h) => overlapRatio(range.startDate, range.endDate, h.startAt, h.endAt) > 0);
}

export function calendarEventsAsNormalized(range: DateRange): NormalizedExternalEvent[] {
  return listCalendarHits(range).map((h) => ({
    eventType: h.kind,
    title: h.title,
    startAt: h.startAt,
    endAt: h.endAt,
    location: "Saudi Arabia",
    importance: h.kind === "school" ? "national" : "national",
    teams: [],
    source: h.source,
    provenance: h.source,
  }));
}

export function rememberCalendarFacts(branchId: string | null, range: DateRange): ExternalContextFact[] {
  const now = new Date().toISOString();
  return listCalendarHits(range).map((h) => {
    const id = factId(["cal", h.id, range.startDate, range.endDate, branchId]);
    const existing = getExternalFact(id);
    if (existing) return existing;
    const overlap = overlapRatio(range.startDate, range.endDate, h.startAt, h.endAt);
    return upsertExternalFact({
      id,
      branchId,
      locationLabel: null,
      type: h.kind === "school" ? "school_calendar" : h.kind === "islamic" ? "islamic_calendar" : "saudi_public_holidays",
      startAt: h.startAt,
      endAt: h.endAt,
      metricOrEvent: h.id,
      value: Math.round(overlap * 1000) / 1000,
      units: "overlap_ratio",
      source: h.source,
      sourceUrl: null,
      fetchedAt: now,
      immutableHistorical: true,
      quality: h.quality,
      metadata: { title: h.title, kind: h.kind },
    }).fact;
  });
}
