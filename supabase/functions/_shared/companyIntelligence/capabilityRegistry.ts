/**
 * Semantic capability registry — planner chooses capabilities, not raw DB names.
 */

export type CapabilityId =
  | "commercial.performance"
  | "commercial.compare"
  | "commercial.trend"
  | "commercial.rank_days"
  | "commercial.forecast"
  | "operations.review"
  | "operations.recurring_issues"
  | "staff.performance"
  | "guest.feedback"
  | "menu.performance"
  | "cost.margin_analysis"
  | "company.branch_timeline"
  | "company.scope_compare"
  | "calendar.resolve_period"
  | "research.historical_weather"
  | "research.external_events"
  | "analytics.safe_compute";

export type CapabilityDefinition = {
  id: CapabilityId;
  domain: string;
  description: string;
  /** Existing Ask NAC / vault tool mapping (implementation detail). */
  implementationTool: string;
  requiresPaidModel: boolean;
  defaultBudgetTier: 0 | 1 | 2 | 3;
};

export const CAPABILITY_REGISTRY: Record<CapabilityId, CapabilityDefinition> = Object.freeze({
  "commercial.performance": {
    id: "commercial.performance",
    domain: "COMMERCIAL",
    description: "Branch commercial performance snapshot",
    implementationTool: "cash_up_performance",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commercial.compare": {
    id: "commercial.compare",
    domain: "COMMERCIAL",
    description: "Period-over-period commercial comparison",
    implementationTool: "cash_up_compare",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "commercial.trend": {
    id: "commercial.trend",
    domain: "COMMERCIAL",
    description: "Trend direction over recent periods",
    implementationTool: "cash_up_compare",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "commercial.rank_days": {
    id: "commercial.rank_days",
    domain: "COMMERCIAL",
    description: "Rank best/worst sales days",
    implementationTool: "cash_up_day_ranking",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commercial.forecast": {
    id: "commercial.forecast",
    domain: "COMMERCIAL",
    description: "Bounded event-window commercial forecast / expectations",
    implementationTool: "event_forecast",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "operations.review": {
    id: "operations.review",
    domain: "OPERATIONS",
    description: "In-range operational / logbook review",
    implementationTool: "operational_evidence",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "operations.recurring_issues": {
    id: "operations.recurring_issues",
    domain: "OPERATIONS",
    description: "Recurring operational issues",
    implementationTool: "operational_evidence",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "staff.performance": {
    id: "staff.performance",
    domain: "STAFF",
    description: "Staff performance evidence when available",
    implementationTool: "staff_performance",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "guest.feedback": {
    id: "guest.feedback",
    domain: "GUEST",
    description: "Guest feedback / reception signals",
    implementationTool: "guest_feedback",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "menu.performance": {
    id: "menu.performance",
    domain: "MENU",
    description: "Menu performance metrics",
    implementationTool: "menu_performance",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "cost.margin_analysis": {
    id: "cost.margin_analysis",
    domain: "COST",
    description: "Canonical cost/margin analysis when available",
    implementationTool: "cost_margin",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "company.branch_timeline": {
    id: "company.branch_timeline",
    domain: "COMPANY",
    description: "Branch opening/closure/timeline facts",
    implementationTool: "business_timeline",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "company.scope_compare": {
    id: "company.scope_compare",
    domain: "COMPANY",
    description: "Cross-branch or cross-brand compare",
    implementationTool: "branch_compare",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "calendar.resolve_period": {
    id: "calendar.resolve_period",
    domain: "TEMPORAL",
    description: "Resolve semantic calendar periods to exact dates",
    implementationTool: "temporal_service",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "research.historical_weather": {
    id: "research.historical_weather",
    domain: "RESEARCH",
    description: "Historical weather for a geography/period",
    implementationTool: "research_weather",
    requiresPaidModel: false,
    defaultBudgetTier: 3,
  },
  "research.external_events": {
    id: "research.external_events",
    domain: "RESEARCH",
    description: "Bounded external/local event research",
    implementationTool: "research_external",
    requiresPaidModel: true,
    defaultBudgetTier: 3,
  },
  "analytics.safe_compute": {
    id: "analytics.safe_compute",
    domain: "ANALYTICS",
    description: "Allowlisted deterministic statistical compute",
    implementationTool: "safe_analytics",
    requiresPaidModel: false,
    defaultBudgetTier: 2,
  },
}) as Record<CapabilityId, CapabilityDefinition>;

export function mapCapabilitiesToTools(capabilityIds: CapabilityId[]): string[] {
  const tools: string[] = [];
  for (const id of capabilityIds) {
    const def = CAPABILITY_REGISTRY[id];
    if (def && !tools.includes(def.implementationTool)) tools.push(def.implementationTool);
  }
  return tools.slice(0, 6);
}

export function isRegisteredCapability(id: string): id is CapabilityId {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, id);
}
