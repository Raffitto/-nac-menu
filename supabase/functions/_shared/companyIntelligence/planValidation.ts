/**
 * Validate capability plans before execution.
 */

import {
  CAPABILITY_REGISTRY,
  isRegisteredCapability,
  type CapabilityId,
} from "./capabilityRegistry.ts";
import type { CompanyIntelligenceState } from "./intelligenceState.ts";
import { canSourceOverride } from "./sourceAuthority.ts";

export type PlanValidationResult = {
  ok: boolean;
  capabilities: CapabilityId[];
  rejected: Array<{ capability: string; reason: string }>;
  reasons: string[];
};

const MAX_CAPABILITIES = 6;

export function validateCapabilityPlan(
  state: CompanyIntelligenceState,
  requested: string[],
): PlanValidationResult {
  const rejected: Array<{ capability: string; reason: string }> = [];
  const capabilities: CapabilityId[] = [];
  const reasons: string[] = [];

  for (const raw of requested.slice(0, MAX_CAPABILITIES + 2)) {
    if (!isRegisteredCapability(raw)) {
      rejected.push({ capability: raw, reason: "not_allowlisted" });
      continue;
    }
    if (capabilities.includes(raw)) continue;

    if (
      (raw === "research.external_events" || raw === "research.historical_weather")
      && (state.plan.researchBudgetTier || 0) < 3
    ) {
      rejected.push({ capability: raw, reason: "budget_tier_too_low" });
      continue;
    }

    if (
      (raw.startsWith("commercial.") || raw === "operations.review")
      && !state.periods.current
      && raw !== "company.branch_timeline"
      && raw !== "calendar.resolve_period"
      && !(raw === "commercial.forecast" && state.periods.forecast)
    ) {
      // Allow timeline/calendar without period; commercial needs period unless infeasible already handled.
      // Forecast may run against periods.forecast when historical current window is unavailable.
      if (state.feasibility?.status !== "NOT_ANSWERABLE_AS_REQUESTED"
        && state.feasibility?.status !== "PARTIALLY_ANSWERABLE") {
        rejected.push({ capability: raw, reason: "period_unresolved" });
        continue;
      }
    }

    if (
      !state.scope.primaryBranchId
      && !state.scope.access.canSeeNetwork
      && raw !== "calendar.resolve_period"
      && raw !== "company.branch_timeline"
    ) {
      rejected.push({ capability: raw, reason: "scope_ambiguous" });
      continue;
    }

    // Foodics never selected as commercial capability.
    const impl = CAPABILITY_REGISTRY[raw].implementationTool;
    if (impl.includes("foodics") && !canSourceOverride("foodics", "cash_up")) {
      rejected.push({ capability: raw, reason: "source_authority_blocked" });
      continue;
    }

    capabilities.push(raw);
  }

  if (capabilities.length > MAX_CAPABILITIES) {
    reasons.push("trimmed_to_max_operations");
    capabilities.length = MAX_CAPABILITIES;
  }

  if (!capabilities.length) {
    reasons.push("no_valid_capabilities");
    return { ok: false, capabilities: [], rejected, reasons };
  }

  if (
    state.cost.maxPaidCallsPerAnswer != null
    && state.cost.paidModelCallsPerAnswer > state.cost.maxPaidCallsPerAnswer
  ) {
    reasons.push("paid_call_ceiling_exceeded");
  }

  return {
    ok: true,
    capabilities,
    rejected,
    reasons,
  };
}
