/**
 * Business timeline registry — structural operating facts.
 * Khobar opening is a trusted config fact, not prompt text.
 */

import type { BranchId, DateRange, IsoDate } from "./types.ts";

export type TimelineEventType =
  | "opened"
  | "closed"
  | "soft_opening"
  | "temporary_closure"
  | "renovation"
  | "hours_change"
  | "menu_relaunch"
  | "pricing_change"
  | "source_availability_change";

export type TimelineEvent = {
  id: string;
  companyId: string;
  brandId: string;
  branchId: BranchId;
  type: TimelineEventType;
  effectiveDate: IsoDate;
  endDate?: IsoDate | null;
  note?: string | null;
  source: string;
};

export type OperatingStatus = {
  status: "operating" | "not_yet_open" | "closed" | "temporary_closure" | "unknown";
  branchId: BranchId;
  range: DateRange;
  openingDate: IsoDate | null;
  closingDate: IsoDate | null;
  overlappingEvents: TimelineEvent[];
  reasons: string[];
};

export interface BusinessTimelineRegistry {
  listEvents(branchId: BranchId): TimelineEvent[];
  getOpeningDate(branchId: BranchId): IsoDate | null;
  getOperatingStatus(branchId: BranchId, range: DateRange): OperatingStatus;
}

/** Trusted seed facts — extend via DB/adapters later without changing callers. */
export const TRUSTED_TIMELINE_EVENTS: TimelineEvent[] = Object.freeze([
  {
    id: "nac-khobar-opened-2025-04-27",
    companyId: "nac_hospitality",
    brandId: "nac",
    branchId: "khobar",
    type: "opened",
    effectiveDate: "2025-04-27",
    note: "Khobar began trading",
    source: "trusted_company_config",
  },
]) as TimelineEvent[];

function parseIso(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}

function rangeFullyBefore(range: DateRange, date: IsoDate): boolean {
  return parseIso(range.endDate) < parseIso(date);
}

function rangeFullyAfter(range: DateRange, date: IsoDate): boolean {
  return parseIso(range.startDate) > parseIso(date);
}

export function createStaticBusinessTimeline(
  events: TimelineEvent[] = TRUSTED_TIMELINE_EVENTS,
): BusinessTimelineRegistry {
  return {
    listEvents(branchId) {
      return events.filter((e) => e.branchId === branchId);
    },
    getOpeningDate(branchId) {
      const opened = events
        .filter((e) => e.branchId === branchId && e.type === "opened")
        .sort((a, b) => parseIso(a.effectiveDate) - parseIso(b.effectiveDate));
      return opened[0]?.effectiveDate || null;
    },
    getOperatingStatus(branchId, range) {
      const branchEvents = events.filter((e) => e.branchId === branchId);
      const opening = this.getOpeningDate(branchId);
      const closed = branchEvents
        .filter((e) => e.type === "closed")
        .sort((a, b) => parseIso(a.effectiveDate) - parseIso(b.effectiveDate))[0]?.effectiveDate || null;

      const overlapping = branchEvents.filter((e) => {
        const start = parseIso(e.effectiveDate);
        const end = parseIso(e.endDate || e.effectiveDate);
        const rs = parseIso(range.startDate);
        const re = parseIso(range.endDate);
        return start <= re && end >= rs;
      });

      const reasons: string[] = [];
      if (opening && rangeFullyBefore(range, opening)) {
        reasons.push("branch_not_operating_in_baseline_period");
        reasons.push(`branch_opened_on_${opening}`);
        return {
          status: "not_yet_open",
          branchId,
          range,
          openingDate: opening,
          closingDate: closed,
          overlappingEvents: overlapping,
          reasons,
        };
      }
      if (closed && rangeFullyAfter(range, closed)) {
        reasons.push("branch_closed_before_period");
        return {
          status: "closed",
          branchId,
          range,
          openingDate: opening,
          closingDate: closed,
          overlappingEvents: overlapping,
          reasons,
        };
      }
      const temp = overlapping.filter((e) => e.type === "temporary_closure" || e.type === "renovation");
      if (temp.length) {
        reasons.push("temporary_closure_or_renovation_overlap");
        return {
          status: "temporary_closure",
          branchId,
          range,
          openingDate: opening,
          closingDate: closed,
          overlappingEvents: overlapping,
          reasons,
        };
      }
      if (!opening) {
        return {
          status: "unknown",
          branchId,
          range,
          openingDate: null,
          closingDate: closed,
          overlappingEvents: overlapping,
          reasons: ["opening_date_unknown"],
        };
      }
      return {
        status: "operating",
        branchId,
        range,
        openingDate: opening,
        closingDate: closed,
        overlappingEvents: overlapping,
        reasons: [],
      };
    },
  };
}

export const defaultBusinessTimeline = createStaticBusinessTimeline();
