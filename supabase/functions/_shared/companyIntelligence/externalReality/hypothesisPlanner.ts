import type { EvidenceRecord } from "../evidenceLedger.ts";
import type { DateRange } from "../types.ts";
import { MAGNITUDE_FLAT_PCT } from "../managementPresentation.ts";
import type {
  CandidateHypothesis,
  ExternalCategory,
  ExternalHypothesisPlan,
  UnexplainedSignal,
} from "./types.ts";

const FLAT = MAGNITUDE_FLAT_PCT || 3;

export type ExternalIntent = {
  weather: boolean;
  sports: boolean;
  school: boolean;
  calendar: boolean;
  local: boolean;
  traffic: boolean;
  outside: boolean;
  strongestDays: boolean;
  explanation: boolean;
};

export function detectExternalIntent(question: string): ExternalIntent {
  const q = String(question || "").toLowerCase();
  return {
    weather: /\b(weather|heat|hot|humidity|rain|temperature|humid)\b/.test(q),
    sports: /\b(football|soccer|match(?:es)?|world cup|derby|fifa|sports?)\b/.test(q),
    school: /\b(school|university|exam|academic|term break)\b/.test(q)
      || (/\bholiday period\b/.test(q) && !/\bnational day|founding|eid|ramadan\b/.test(q)),
    calendar: /\b(ramadan|eid|national day|founding day|public holiday)\b/.test(q),
    local: /\b(concert|festival|exhibition|mall event|local event)\b/.test(q),
    traffic: /\b(traffic|congestion|road closure|accessibility)\b/.test(q),
    outside: /\b(outside the restaurant|external factor|anything outside|external context)\b/.test(q),
    strongestDays: /\b(strongest days|best days|busiest days)\b/.test(q),
    explanation: /\b(why|explain|weaker|stronger|declined|what drove)\b/.test(q),
  };
}

export function shouldConsiderExternalReality(question: string, goal?: string): boolean {
  const intent = detectExternalIntent(question);
  if (goal === "knowledge_freshness" || goal === "coverage_query" || goal === "acquisition_request") {
    return false;
  }
  if (intent.weather || intent.sports || intent.school || intent.calendar || intent.local || intent.traffic || intent.outside || intent.strongestDays) {
    return true;
  }
  return intent.explanation;
}

export function classifyUnexplainedSignal(evidence: EvidenceRecord[]): UnexplainedSignal {
  const sales = num(evidence, "delta_pct") ?? num(evidence, "net_sales_delta_pct");
  const covers = num(evidence, "covers_delta_pct");
  const spend = num(evidence, "avg_spend_delta_pct");
  if (sales == null && covers == null && spend == null) return "internally_unexplained";
  if (sales != null && Math.abs(sales) < FLAT) return "flat_insignificant";
  const salesDown = sales != null && sales <= -FLAT;
  const coversDown = covers != null && covers <= -FLAT;
  const spendDown = spend != null && spend <= -FLAT;
  if (salesDown && coversDown && (spend == null || Math.abs(spend) < FLAT)) return "demand_covers_driven";
  if (salesDown && spendDown && (covers == null || Math.abs(covers) < FLAT)) return "spend_basket_driven";
  if (salesDown && !coversDown && !spendDown) return "internally_unexplained";
  if (coversDown || spendDown) return "mix_driven";
  return "internally_sufficient";
}

function num(evidence: EvidenceRecord[], key: string): number | null {
  const row = evidence.find((e) => e.metricOrEvent === key && typeof e.value === "number");
  return row ? Number(row.value) : null;
}

export function planExternalHypotheses(input: {
  question: string;
  unexplainedSignal: UnexplainedSignal;
  current: DateRange | null;
  comparison: DateRange | null;
}): ExternalHypothesisPlan {
  const intent = detectExternalIntent(input.question);
  const candidates: CandidateHypothesis[] = [];

  const push = (category: ExternalCategory, rationale: string, priority: number) => {
    if (candidates.some((c) => c.category === category)) return;
    candidates.push({ category, rationale, priority });
  };

  if (intent.weather) push("weather", "Question asks about weather context.", 10);
  if (intent.sports) push("sports_events", "Question asks about football/sports overlap.", 10);
  if (intent.school) push("school_calendar", "Question asks about school-holiday trading.", 10);
  if (intent.calendar) push("islamic_calendar", "Question asks about Ramadan/Eid/public holidays.", 9);
  if (intent.calendar) push("saudi_public_holidays", "National/Founding Day overlap check.", 8);
  if (intent.local) push("local_events", "Question asks about concerts/festivals/mall events.", 8);
  if (intent.traffic) push("traffic", "Question asks about access/congestion (likely unavailable).", 1);
  if (intent.strongestDays || intent.outside) {
    push("weather", "External factors on strong/weak windows.", 8);
    push("sports_events", "Major football windows as demand context.", 7);
    push("school_calendar", "School-break travel demand.", 6);
    push("islamic_calendar", "Ramadan/Eid overlap if any.", 5);
  }

  if (intent.explanation && !intent.weather && !intent.sports && !intent.school && !intent.calendar && !intent.local) {
    if (input.unexplainedSignal === "internally_sufficient" || input.unexplainedSignal === "flat_insignificant") {
      return {
        internalQuestion: input.question,
        unexplainedSignal: input.unexplainedSignal,
        candidateHypotheses: [],
        selectedTools: [],
        stopReason: "internal_evidence_sufficient",
      };
    }
    if (input.unexplainedSignal === "demand_covers_driven" || input.unexplainedSignal === "internally_unexplained") {
      push("weather", "Volume/covers movement can coincide with outdoor comfort extremes.", 9);
      push("school_calendar", "School breaks can coincide with family dining demand shifts.", 8);
      push("sports_events", "Major football windows can coincide with occupancy changes.", 7);
      push("islamic_calendar", "Ramadan/Eid windows if they overlap the trading period.", 6);
    } else if (input.unexplainedSignal === "spend_basket_driven") {
      push("islamic_calendar", "Calendar periods sometimes coincide with check-size shifts.", 8);
      push("weather", "Heat can coincide with shorter dwell / different mix; check only if unexplained remains.", 5);
    } else {
      push("weather", "Residual movement after internal mix — cheap weather context.", 7);
      push("sports_events", "Check major sports overlap as negative or supporting evidence.", 6);
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const selected = candidates.slice(0, 4);
  const tools = selected.map((c) => {
    if (c.category === "weather") return "external.weather";
    if (c.category === "sports_events") return "external.sports";
    if (c.category === "local_events") return "external.local_events";
    if (c.category === "traffic") return "external.traffic";
    if (c.category === "web_research_fallback") return "external.web_fallback";
    return "external.calendar";
  });

  return {
    internalQuestion: input.question,
    unexplainedSignal: input.unexplainedSignal,
    candidateHypotheses: selected,
    selectedTools: [...new Set(tools)],
    stopReason: selected.length ? null : "no_plausible_external_hypothesis",
  };
}
