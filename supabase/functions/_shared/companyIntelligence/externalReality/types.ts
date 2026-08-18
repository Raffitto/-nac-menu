import type { BranchId, DateRange, IsoDate } from "../types.ts";
import type { ExternalCostClass } from "./costGovernor.ts";

export type ExternalCategory =
  | "weather"
  | "saudi_public_holidays"
  | "islamic_calendar"
  | "school_calendar"
  | "sports_events"
  | "local_events"
  | "traffic"
  | "web_research_fallback";

export type AssociationStrength =
  | "strong_temporal_association"
  | "moderate_association"
  | "weak_possible_contributor"
  | "no_meaningful_signal";

export type UnexplainedSignal =
  | "demand_covers_driven"
  | "spend_basket_driven"
  | "mix_driven"
  | "internally_unexplained"
  | "internally_sufficient"
  | "flat_insignificant";

export type ExternalSourceStatus = "LIVE" | "SEEDED" | "UNAVAILABLE_IN_FOUNDER_FREE_MODE" | "REJECTED";

export type ExternalSourceDescriptor = {
  id: string;
  category: ExternalCategory;
  source: string;
  url: string;
  license: string;
  costClass: ExternalCostClass;
  temporalCoverage: string;
  geographicCoverage: string;
  cachingPolicy: string;
  reliability: "high" | "medium" | "low" | "unavailable";
  freshness: string;
  supportedQueryType: string;
  status: ExternalSourceStatus;
  notes: string;
};

export type ExternalContextFact = {
  id: string;
  branchId: BranchId | null;
  locationLabel: string | null;
  type: ExternalCategory | string;
  startAt: IsoDate;
  endAt: IsoDate;
  metricOrEvent: string;
  value: number | string | null;
  units: string | null;
  source: string;
  sourceUrl: string | null;
  fetchedAt: string;
  immutableHistorical: boolean;
  quality: "high" | "medium" | "low";
  metadata: Record<string, unknown>;
};

export type NormalizedExternalEvent = {
  eventType: string;
  title: string;
  startAt: IsoDate;
  endAt: IsoDate;
  location: string | null;
  importance: "local" | "national" | "regional" | "global";
  teams: string[];
  source: string;
  provenance: string;
};

export type CandidateHypothesis = {
  category: ExternalCategory;
  rationale: string;
  priority: number;
};

export type ExternalHypothesisPlan = {
  internalQuestion: string;
  unexplainedSignal: UnexplainedSignal;
  candidateHypotheses: CandidateHypothesis[];
  selectedTools: string[];
  stopReason: string | null;
};

export type ExternalFinding = {
  category: ExternalCategory;
  strength: AssociationStrength;
  statement: string;
  facts: ExternalContextFact[];
  costClass: ExternalCostClass;
  cached: boolean;
  rejectedHypothesis: boolean;
};

export type ExternalRealityResult = {
  plan: ExternalHypothesisPlan;
  findings: ExternalFinding[];
  answerSection: string;
  externalCalls: number;
  paidCalls: number;
  cacheHits: number;
  stoppedBecause: string;
  latencyMs: number;
  alignedCurrent: DateRange | null;
  alignedComparison: DateRange | null;
};
