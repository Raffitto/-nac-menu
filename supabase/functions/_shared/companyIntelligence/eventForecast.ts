/**
 * Bounded event-window forecast engine for Company Intelligence.
 * Distinguishes OBSERVED / DERIVED / FORECAST. Never invents historical rows.
 */

import {
  weekdayComposition,
  weekdayCompositionsMatch,
  type WeekdayComposition,
} from "./businessCalendar.ts";
import type { ResolvedEventWindow } from "./holidayCalendar.ts";
import type { DateRange, IsoDate } from "./types.ts";

export type ForecastObservationKind = "OBSERVED" | "DERIVED" | "FORECAST";

export type EventPerformanceObservation = {
  eventId: string;
  year: number;
  range: DateRange;
  netSales: number | null;
  covers: number | null;
  orders: number | null;
  averageSpend: number | null;
  dailyBreakdown?: Array<{ date: IsoDate; netSales: number | null }>;
  coverageRatio: number | null;
  source: string;
  kind: ForecastObservationKind;
  weekdayComposition: WeekdayComposition;
};

export type RecentTradingBaseline = {
  label: string;
  range: DateRange;
  netSales: number | null;
  dailyAverageNetSales: number | null;
  coverageRatio: number | null;
  source: string;
  kind: ForecastObservationKind;
};

export type EventForecastResult = {
  ok: boolean;
  kind: "FORECAST";
  method: string;
  centralEstimate: number | null;
  expectedRange: { low: number; high: number } | null;
  unit: string;
  confidence: "high" | "medium" | "low" | "insufficient";
  assumptions: string[];
  limitations: string[];
  comparabilityNotes: string[];
  weekdayCompositionMatch: boolean | null;
  historicalObservationCount: number;
  includesExternalFactors: boolean;
  targetWindow: DateRange | null;
  targetAnchorDate: IsoDate | null;
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Do not average averages — derive spend only from totals/covers. */
export function deriveAverageSpend(netSales: number | null, covers: number | null): number | null {
  if (netSales == null || covers == null || covers <= 0) return null;
  return netSales / covers;
}

export function buildEventPerformanceObservation(input: {
  eventWindow: ResolvedEventWindow;
  netSales?: number | null;
  covers?: number | null;
  orders?: number | null;
  dailyBreakdown?: Array<{ date: IsoDate; netSales: number | null }>;
  coverageRatio?: number | null;
  source?: string;
}): EventPerformanceObservation {
  const netSales = input.netSales ?? null;
  const covers = input.covers ?? null;
  return {
    eventId: input.eventWindow.holidayId,
    year: input.eventWindow.year,
    range: input.eventWindow.range,
    netSales,
    covers,
    orders: input.orders ?? null,
    averageSpend: deriveAverageSpend(netSales, covers),
    dailyBreakdown: input.dailyBreakdown,
    coverageRatio: input.coverageRatio ?? null,
    source: input.source || "cash_up",
    kind: "OBSERVED",
    weekdayComposition: input.eventWindow.weekdayComposition,
  };
}

/**
 * First-pass bounded forecast:
 * - Prefer prior same-named event observations (Cash Up)
 * - Blend lightly with recent daily average when available
 * - Penalize confidence for single observation / weekday mismatch / weak coverage
 * - Never claim external causality
 */
export function forecastEventWindow(input: {
  targetWindow: ResolvedEventWindow | null;
  historicalObservations: EventPerformanceObservation[];
  recentBaseline?: RecentTradingBaseline | null;
  branchOperatingInTarget?: boolean;
}): EventForecastResult {
  const assumptions: string[] = [
    "Forecast uses same-named holiday event windows where available.",
    "Canonical Cash Up commercial evidence is authoritative for historical sales.",
    "Forecast does not include weather, local events, economic, or political factors.",
  ];
  const limitations: string[] = [];
  const comparabilityNotes: string[] = [];

  if (!input.targetWindow) {
    return {
      ok: false,
      kind: "FORECAST",
      method: "none",
      centralEstimate: null,
      expectedRange: null,
      unit: "SAR",
      confidence: "insufficient",
      assumptions,
      limitations: ["target_event_window_unresolved"],
      comparabilityNotes,
      weekdayCompositionMatch: null,
      historicalObservationCount: 0,
      includesExternalFactors: false,
      targetWindow: null,
      targetAnchorDate: null,
    };
  }

  if (input.branchOperatingInTarget === false) {
    return {
      ok: false,
      kind: "FORECAST",
      method: "none",
      centralEstimate: null,
      expectedRange: null,
      unit: "SAR",
      confidence: "insufficient",
      assumptions,
      limitations: ["branch_not_expected_to_operate_in_target_window"],
      comparabilityNotes,
      weekdayCompositionMatch: null,
      historicalObservationCount: input.historicalObservations.length,
      includesExternalFactors: false,
      targetWindow: input.targetWindow.range,
      targetAnchorDate: input.targetWindow.anchorDate,
    };
  }

  const observed = (input.historicalObservations || []).filter(
    (o) => o.kind === "OBSERVED" && o.netSales != null && Number.isFinite(o.netSales),
  );
  const histSales = observed.map((o) => Number(o.netSales));
  const histCount = histSales.length;

  if (!histCount && !(input.recentBaseline?.dailyAverageNetSales != null)) {
    return {
      ok: false,
      kind: "FORECAST",
      method: "insufficient_data",
      centralEstimate: null,
      expectedRange: null,
      unit: "SAR",
      confidence: "insufficient",
      assumptions,
      limitations: [
        "no_observed_same_event_history",
        "no_recent_trading_baseline",
      ],
      comparabilityNotes,
      weekdayCompositionMatch: null,
      historicalObservationCount: 0,
      includesExternalFactors: false,
      targetWindow: input.targetWindow.range,
      targetAnchorDate: input.targetWindow.anchorDate,
    };
  }

  const targetComp = input.targetWindow.weekdayComposition;
  let weekdayMatch: boolean | null = null;
  if (observed.length) {
    const matches = observed.map((o) => weekdayCompositionsMatch(o.weekdayComposition, targetComp));
    weekdayMatch = matches.every(Boolean);
    if (!weekdayMatch) {
      comparabilityNotes.push("weekday_composition_differs_from_historical_event_window");
      assumptions.push(
        "Next event weekday composition differs from prior observation(s); not treated as like-for-like.",
      );
    } else {
      comparabilityNotes.push("weekday_composition_matches_historical_event_window");
    }
  }

  const eventMean = mean(histSales);
  const recentDaily = input.recentBaseline?.dailyAverageNetSales ?? null;
  const targetDays = input.targetWindow.dates.length || 3;
  const recentWindowEstimate = recentDaily != null ? recentDaily * targetDays : null;

  let method = "same_event_history_mean";
  let central: number | null = eventMean;
  if (eventMean != null && recentWindowEstimate != null) {
    // Light blend — recent trading informs level; event history anchors holiday effect.
    const eventWeight = histCount >= 2 ? 0.75 : 0.55;
    central = eventMean * eventWeight + recentWindowEstimate * (1 - eventWeight);
    method = histCount >= 2
      ? "blended_event_history_and_recent_trading"
      : "single_event_observation_blended_with_recent_trading";
  } else if (eventMean == null && recentWindowEstimate != null) {
    central = recentWindowEstimate;
    method = "recent_trading_baseline_only";
    limitations.push("no_same_named_event_observation");
  } else if (eventMean != null && recentWindowEstimate == null) {
    method = histCount === 1 ? "single_event_observation_carry_forward_adjusted" : "same_event_history_mean";
    if (histCount === 1) {
      // Do not copy last year blindly — mild uncertainty band only, central stays observed level.
      assumptions.push("Only one historical Founding Day observation is available for this branch.");
    }
  }

  if (weekdayMatch === false && central != null) {
    method = `${method}+weekday_composition_adjustment_flag`;
  }

  let confidence: EventForecastResult["confidence"] = "medium";
  if (histCount === 0) confidence = "low";
  if (histCount === 1) confidence = "low";
  if (histCount >= 3 && weekdayMatch !== false) confidence = "medium";
  if (histCount >= 3 && weekdayMatch && (input.recentBaseline?.coverageRatio ?? 1) >= 0.8) {
    confidence = "high";
  }
  if (weekdayMatch === false && confidence === "high") confidence = "medium";
  if (weekdayMatch === false && confidence === "medium") confidence = "low";

  const weakCoverage = observed.some((o) => o.coverageRatio != null && o.coverageRatio < 0.8);
  if (weakCoverage) {
    confidence = confidence === "high" ? "medium" : "low";
    limitations.push("historical_event_coverage_incomplete");
  }

  let expectedRange: { low: number; high: number } | null = null;
  if (central != null) {
    const spread = histCount <= 1 || weekdayMatch === false ? 0.22 : histCount === 2 ? 0.15 : 0.1;
    expectedRange = {
      low: Math.round(central * (1 - spread)),
      high: Math.round(central * (1 + spread)),
    };
    central = Math.round(central);
  }

  limitations.push("external_factors_not_modeled");

  return {
    ok: central != null,
    kind: "FORECAST",
    method,
    centralEstimate: central,
    expectedRange,
    unit: "SAR",
    confidence,
    assumptions,
    limitations,
    comparabilityNotes,
    weekdayCompositionMatch: weekdayMatch,
    historicalObservationCount: histCount,
    includesExternalFactors: false,
    targetWindow: input.targetWindow.range,
    targetAnchorDate: input.targetWindow.anchorDate,
  };
}

export function emptyObservationFromWindow(window: ResolvedEventWindow): EventPerformanceObservation {
  return {
    eventId: window.holidayId,
    year: window.year,
    range: window.range,
    netSales: null,
    covers: null,
    orders: null,
    averageSpend: null,
    coverageRatio: 0,
    source: "cash_up",
    kind: "OBSERVED",
    weekdayComposition: window.weekdayComposition || weekdayComposition(window.dates),
  };
}
