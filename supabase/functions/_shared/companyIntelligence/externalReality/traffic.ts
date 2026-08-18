import type { ExternalFinding } from "./types.ts";

export function trafficUnavailableFinding(): ExternalFinding {
  return {
    category: "traffic",
    strength: "no_meaningful_signal",
    statement: "Historical traffic, congestion, and road-closure data around Grand House Open Mall is UNAVAILABLE_IN_FOUNDER_FREE_MODE. Credible sources (TomTom, Google, HERE) require paid APIs and were not integrated.",
    facts: [],
    costClass: 3,
    cached: false,
    rejectedHypothesis: true,
  };
}
