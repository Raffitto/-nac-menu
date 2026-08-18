/**
 * Multi-domain query plan. Planner selects evidence legs; executors stay deterministic.
 */

import type { DateRange } from "../types.ts";
import type { DomainId } from "./domainRegistry.ts";

export type UniversalIntent =
  | "diagnostic"
  | "comparison"
  | "driver_analysis"
  | "opportunity"
  | "contradiction"
  | "event_before_after"
  | "follow_up";

export type UniversalEvidenceLeg = {
  domain: DomainId;
  capability: string;
  metric?: string | null;
  operators?: string[];
  filters?: Array<{ field: string; op: string; value?: string | number | boolean }>;
  optional?: boolean;
};

export type UniversalQueryPlan = {
  intent: UniversalIntent;
  question: string;
  branchScope: string[];
  period: DateRange | null;
  compare: DateRange | null;
  evidence: UniversalEvidenceLeg[];
  alignment: Array<"period" | "branch" | "weekend" | "event_cutover">;
  synthesis: "management" | "partial" | "limitation";
  previousPlan?: UniversalQueryPlan | null;
  event?: { name: string; date: string | null; resolved: boolean } | null;
  unavailable?: { field: string; reason: string } | null;
};

export type UniversalEvidence = {
  domain: DomainId;
  authority: string;
  metric: string;
  value: number | string | null;
  unit?: string | null;
  dimensions?: Record<string, string | number | null>;
  period: DateRange | null;
  branchScope: string[];
  coverage?: { startDate?: string | null; endDate?: string | null; complete?: boolean } | null;
  quality: "strong_direct" | "strong_derived" | "directional" | "unavailable";
  provenance: string;
  warnings: string[];
  text?: string | null;
  skipped?: boolean;
  skipReason?: string | null;
};

export function validateUniversalPlan(plan: UniversalQueryPlan): { ok: boolean; reason?: string } {
  if (!plan.evidence.length && !plan.unavailable) {
    return { ok: false, reason: "No evidence legs and no limitation." };
  }
  if (plan.evidence.length > 5) {
    return { ok: false, reason: "Too many evidence legs; bound the plan." };
  }
  return { ok: true };
}
