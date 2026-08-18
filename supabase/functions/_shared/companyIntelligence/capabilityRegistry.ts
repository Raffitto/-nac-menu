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
  | "analytics.safe_compute"
  | "commerce.session_mix"
  | "commerce.attachment"
  | "commerce.item_mix"
  | "commerce.rank_items"
  | "commerce.basket_relationship"
  | "commerce.compare_mix"
  | "commerce.branch_decomposition"
  | "commerce.opportunity_model"
  | "commerce.semantic_query"
  | "company.knowledge_state";

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
    description: "Historical weather for a geography/period (Open-Meteo, cached, founder-free)",
    implementationTool: "research_weather",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "research.external_events": {
    id: "research.external_events",
    domain: "RESEARCH",
    description: "Bounded calendar/sports/local event context (no paid sports API)",
    implementationTool: "research_external",
    requiresPaidModel: false,
    defaultBudgetTier: 1,
  },
  "analytics.safe_compute": {
    id: "analytics.safe_compute",
    domain: "ANALYTICS",
    description: "Allowlisted deterministic statistical compute",
    implementationTool: "safe_analytics",
    requiresPaidModel: false,
    defaultBudgetTier: 2,
  },
  "commerce.session_mix": {
    id: "commerce.session_mix",
    domain: "COMMERCE",
    description: "Dine-in session archetype mix",
    implementationTool: "commerce_session_mix",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.attachment": {
    id: "commerce.attachment",
    domain: "COMMERCE",
    description: "Item/category attachment to sessions",
    implementationTool: "commerce_attachment",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.item_mix": {
    id: "commerce.item_mix",
    domain: "COMMERCE",
    description: "Item and category mix from order items",
    implementationTool: "commerce_item_mix",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.rank_items": {
    id: "commerce.rank_items",
    domain: "COMMERCE",
    description: "Rank items by units or revenue",
    implementationTool: "commerce_item_mix",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.basket_relationship": {
    id: "commerce.basket_relationship",
    domain: "COMMERCE",
    description: "Basket co-occurrence",
    implementationTool: "commerce_attachment",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.compare_mix": {
    id: "commerce.compare_mix",
    domain: "COMMERCE",
    description: "Compare session mix across periods",
    implementationTool: "commerce_session_mix",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.branch_decomposition": {
    id: "commerce.branch_decomposition",
    domain: "COMMERCE",
    description: "Decompose commercial gaps into volume/mix/spend",
    implementationTool: "commerce_decomposition",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.opportunity_model": {
    id: "commerce.opportunity_model",
    domain: "COMMERCE",
    description: "Modeled opportunity estimates from mix/volume scenarios",
    implementationTool: "commerce_opportunity",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "commerce.semantic_query": {
    id: "commerce.semantic_query",
    domain: "COMMERCE",
    description: "General semantic query over canonical commerce orders/items/sessions",
    implementationTool: "commerce_semantic_query",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
  },
  "company.knowledge_state": {
    id: "company.knowledge_state",
    domain: "META",
    description: "Per-domain freshness and coverage of Ask NAC knowledge",
    implementationTool: "knowledge_state",
    requiresPaidModel: false,
    defaultBudgetTier: 0,
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
