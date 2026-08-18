import type { DateRange } from "../types.ts";
import { alignedComparisonWindow } from "./alignment.ts";
import { rememberCalendarFacts, listCalendarHits } from "./calendar.ts";
import { strengthFromOverlap, associationPhrase, sanitizeExternalProse } from "./language.ts";
import { fetchLocalEvents } from "./localEvents.ts";
import { rememberSportsFacts, sportsOverlapping, sportsWeekendOverlap } from "./sports.ts";
import { trafficUnavailableFinding } from "./traffic.ts";
import { fetchAlignedWeather, type WeatherFetchDeps } from "./weather.ts";
import type { ExternalFinding, ExternalRealityResult } from "./types.ts";
import { classifyUnexplainedSignal, planExternalHypotheses } from "./hypothesisPlanner.ts";
import type { EvidenceRecord } from "../evidenceLedger.ts";
import type { LocalEventDeps } from "./localEvents.ts";
import { buildPreviousEquivalentVaultPeriod } from "../../vaultPeriodParser.ts";

export type RunExternalRealityInput = {
  question: string;
  branchId: string | null;
  current: DateRange | null;
  comparison: DateRange | null;
  evidence: EvidenceRecord[];
  weatherDeps?: WeatherFetchDeps;
  localDeps?: LocalEventDeps;
};

export async function runExternalRealityEngine(input: RunExternalRealityInput): Promise<ExternalRealityResult> {
  const started = Date.now();
  const unexplained = classifyUnexplainedSignal(input.evidence);
  const plan = planExternalHypotheses({
    question: input.question,
    unexplainedSignal: unexplained,
    current: input.current,
    comparison: input.comparison,
  });

  if (!input.current) {
    return emptyResult(plan, "period_unresolved", started, null, null);
  }

  let comparison = input.comparison;
  if (!comparison) {
    comparison = buildPreviousEquivalentVaultPeriod(input.current) as DateRange | null;
  }
  const aligned = comparison
    ? alignedComparisonWindow(input.current, comparison)
    : { current: input.current, comparison: comparison, currentDates: [], comparisonDates: [] };

  if (plan.stopReason === "internal_evidence_sufficient") {
    return emptyResult(plan, plan.stopReason, started, aligned.current, aligned.comparison);
  }

  const findings: ExternalFinding[] = [];
  let externalCalls = 0;
  let cacheHits = 0;
  const cats = new Set(plan.candidateHypotheses.map((c) => c.category));

  if (cats.has("weather")) {
    const curW = await fetchAlignedWeather({
      branchId: input.branchId,
      period: aligned.current,
      deps: input.weatherDeps,
    });
    if (curW.summary.cached) cacheHits += 1;
    else if (!curW.blocked) externalCalls += 1;
    let prevW = null as Awaited<ReturnType<typeof fetchAlignedWeather>> | null;
    if (aligned.comparison) {
      prevW = await fetchAlignedWeather({
        branchId: input.branchId,
        period: aligned.comparison,
        deps: input.weatherDeps,
      });
      if (prevW.summary.cached) cacheHits += 1;
      else if (!prevW.blocked) externalCalls += 1;
    }
    const delta = curW.summary.meanTempC != null && prevW?.summary.meanTempC != null
      ? Math.round((curW.summary.meanTempC - prevW.summary.meanTempC) * 10) / 10
      : null;
    const extreme = (curW.summary.hotDaysGe38 || 0) >= 8 || (delta != null && Math.abs(delta) >= 2.5);
    const strength = curW.blocked
      ? "no_meaningful_signal"
      : (extreme ? "moderate_association" : (delta != null && Math.abs(delta) >= 1 ? "weak_possible_contributor" : "no_meaningful_signal"));
    if (curW.blocked !== "live_fetch_skipped_offline_test") {
      const alignedNote = aligned.comparison
        ? `Weather compared ${aligned.current.startDate}–${aligned.current.endDate} vs aligned ${aligned.comparison.startDate}–${aligned.comparison.endDate}, not a longer unmatched month.`
        : `Weather for ${aligned.current.startDate}–${aligned.current.endDate}.`;
      findings.push({
        category: "weather",
        strength,
        statement: sanitizeExternalProse(
          curW.blocked
            ? `Weather context was not available (${curW.blocked}).`
            : `Mean temperature at Grand House Open Mall was ${curW.summary.meanTempC}°C`
              + (delta != null ? ` (${delta > 0 ? "+" : ""}${delta}°C vs aligned baseline)` : "")
              + ` with ${curW.summary.hotDaysGe38} day(s) at or above 38°C. This ${associationPhrase(strength)} the sales movement. ${alignedNote} Source: Open-Meteo (CC BY 4.0).`,
        ),
        facts: [...curW.facts, ...(prevW?.facts || [])],
        costClass: curW.summary.cached ? 0 : 1,
        cached: Boolean(curW.summary.cached),
        rejectedHypothesis: strength === "no_meaningful_signal",
      });
    }
  }

  if (cats.has("sports_events")) {
    const facts = rememberSportsFacts(input.branchId, aligned.current);
    cacheHits += facts.length;
    const hits = sportsOverlapping(aligned.current);
    const weekends = sportsWeekendOverlap(aligned.current);
    if (!hits.length) {
      findings.push({
        category: "sports_events",
        strength: "no_meaningful_signal",
        statement: "Major football fixtures do not line up strongly with the weak trading windows, so they are unlikely to be a major explanation.",
        facts,
        costClass: 0,
        cached: true,
        rejectedHypothesis: true,
      });
    } else {
      const overlap = Math.max(...hits.map((h) => h.overlap));
      const strength = strengthFromOverlap(overlap, overlap >= 0.3);
      findings.push({
        category: "sports_events",
        strength,
        statement: sanitizeExternalProse(
          `${hits.map((h) => h.title).join("; ")} overlapped ${(overlap * 100).toFixed(0)}% of the trading window`
          + (weekends.overlappingWeekendDays.length
            ? ` (${weekends.overlappingWeekendDays.length} of ${weekends.weekendDays.length} KSA weekend days).`
            : ".")
          + ` This ${associationPhrase(strength)} occupancy. Tournament windows are public FIFA/AFC dates, not a paid sports feed.`,
        ),
        facts,
        costClass: 0,
        cached: true,
        rejectedHypothesis: strength === "no_meaningful_signal",
      });
    }
  }

  if (cats.has("school_calendar") || cats.has("islamic_calendar") || cats.has("saudi_public_holidays")) {
    const facts = rememberCalendarFacts(input.branchId, aligned.current);
    cacheHits += facts.length;
    const hits = listCalendarHits(aligned.current);
    const school = hits.filter((h) => h.kind === "school");
    const islamic = hits.filter((h) => h.kind === "islamic");
    const publicH = hits.filter((h) => h.kind === "public_holiday");
    if (cats.has("school_calendar")) {
      if (!school.length) {
        findings.push({
          category: "school_calendar",
          strength: "no_meaningful_signal",
          statement: "Typical KSA school-holiday windows do not overlap this trading period in a material way, so school calendar is unlikely to be a major explanation.",
          facts,
          costClass: 0,
          cached: true,
          rejectedHypothesis: true,
        });
      } else {
        const overlap = Number(facts.find((f) => f.type === "school_calendar")?.value || 0);
        const strength = strengthFromOverlap(overlap, overlap >= 0.4);
        findings.push({
          category: "school_calendar",
          strength,
          statement: sanitizeExternalProse(
            `${school.map((s) => s.title).join("; ")} overlapped this window. This ${associationPhrase(strength)} family-dining demand. Seeded typical MOE-style windows (medium quality), not a live ministry feed.`,
          ),
          facts: facts.filter((f) => f.type === "school_calendar"),
          costClass: 0,
          cached: true,
          rejectedHypothesis: strength === "no_meaningful_signal",
        });
      }
    }
    if (cats.has("islamic_calendar") || cats.has("saudi_public_holidays")) {
      const calHits = [...islamic, ...publicH];
      if (!calHits.length) {
        findings.push({
          category: "islamic_calendar",
          strength: "no_meaningful_signal",
          statement: "Ramadan, Eid, and Saudi public holidays do not line up strongly with this trading window, so they are unlikely to be a major explanation.",
          facts: facts.filter((f) => f.type !== "school_calendar"),
          costClass: 0,
          cached: true,
          rejectedHypothesis: true,
        });
      } else {
        const overlap = Math.max(0, ...facts.filter((f) => f.type !== "school_calendar").map((f) => Number(f.value) || 0));
        const strength = strengthFromOverlap(overlap, overlap >= 0.2);
        findings.push({
          category: "islamic_calendar",
          strength,
          statement: sanitizeExternalProse(
            `${calHits.map((h) => h.title).join("; ")} overlapped the window. This ${associationPhrase(strength)} trading patterns.`,
          ),
          facts: facts.filter((f) => f.type !== "school_calendar"),
          costClass: 0,
          cached: true,
          rejectedHypothesis: strength === "no_meaningful_signal",
        });
      }
    }
  }

  if (cats.has("local_events")) {
    const local = await fetchLocalEvents({
      period: aligned.current,
      branchId: input.branchId,
      materiallyUseful: unexplained === "internally_unexplained" || detectLocalMaterial(input.question),
      deps: input.localDeps,
    });
    if (local.facts.length && !(local.facts[0].metadata as { cached?: boolean }).cached) externalCalls += 1;
    else cacheHits += 1;
    findings.push({
      category: "local_events",
      strength: local.events.length ? "weak_possible_contributor" : "no_meaningful_signal",
      statement: local.events.length
        ? sanitizeExternalProse(`Dated local events were cached: ${local.events.map((e) => e.title).join("; ")}. Treat as possible coinciding context only.`)
        : "No structured, dated major local events (concerts/festivals/exhibitions) were found for Khobar/Dhahran/Dammam in this window. This does not prove none occurred.",
      facts: local.facts,
      costClass: 2,
      cached: Boolean(local.facts[0] && getCachedFlag(local.facts[0])),
      rejectedHypothesis: !local.events.length,
    });
  }

  if (cats.has("traffic")) {
    findings.push(trafficUnavailableFinding());
  }

  const answerSection = formatExternalSection(findings, unexplained);
  return {
    plan,
    findings,
    answerSection,
    externalCalls,
    paidCalls: 0,
    cacheHits,
    stoppedBecause: findings.length >= 2 || plan.candidateHypotheses.length <= 4
      ? "selected_hypotheses_checked"
      : "complete",
    latencyMs: Date.now() - started,
    alignedCurrent: aligned.current,
    alignedComparison: aligned.comparison,
  };
}

function detectLocalMaterial(question: string) {
  return /\b(concert|festival|exhibition|mall event|local event|outside)\b/i.test(question);
}

function getCachedFlag(fact: { metadata?: Record<string, unknown> }) {
  return Boolean(fact.metadata && (fact.metadata as { cached?: boolean }).cached);
}

function formatExternalSection(findings: ExternalFinding[], unexplained: string): string {
  if (!findings.length) return "";
  const internalNote = unexplained === "internally_sufficient"
    ? "Internal drivers already explain most of the movement."
    : `Internal classification: ${unexplained.replace(/_/g, " ")}.`;
  const supported = findings.filter((f) => !f.rejectedHypothesis);
  const rejected = findings.filter((f) => f.rejectedHypothesis);
  const parts = [
    "Internal drivers: see Cash Up / commerce above.",
    `External context: ${internalNote}`,
    ...supported.map((f) => f.statement),
    ...rejected.map((f) => f.statement),
    "Unknown/unproven factors: external evidence is association only and does not prove causation. Competing restaurants, construction, and unpaid traffic data were not measured.",
  ];
  return parts.join(" ");
}

function emptyResult(
  plan: ExternalRealityResult["plan"],
  stoppedBecause: string,
  started: number,
  current: DateRange | null,
  comparison: DateRange | null,
): ExternalRealityResult {
  return {
    plan,
    findings: [],
    answerSection: stoppedBecause === "internal_evidence_sufficient"
      ? "Internal drivers already explain the majority of the movement, so additional external research was not run."
      : "",
    externalCalls: 0,
    paidCalls: 0,
    cacheHits: 0,
    stoppedBecause,
    latencyMs: Date.now() - started,
    alignedCurrent: current,
    alignedComparison: comparison,
  };
}
