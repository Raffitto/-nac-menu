/**
 * Machine-readable map of domains that are actually ingested and queryable.
 * Do not register hoped-for sources (7Rooms API, staffing grain, etc.).
 */

export type DomainId =
  | "cash_up"
  | "commerce"
  | "reviews"
  | "reception"
  | "operations"
  | "vault"
  | "menu"
  | "timeline"
  | "calendar_events";

export type DomainRegistryEntry = {
  domain: DomainId;
  authority: string;
  authoritativeFor: string[];
  notAuthoritativeFor: string[];
  entities: string[];
  metrics: string[];
  dimensions: string[];
  dateGrain: "day" | "shift" | "event" | "item";
  branchCoverage: string[];
  availablePeriods: string;
  queryCapability: string;
  confidence: "high" | "medium" | "low" | "partial";
  joins: DomainId[];
  knownUnavailable: string[];
  notes: string;
};

export const DOMAIN_REGISTRY: Record<DomainId, DomainRegistryEntry> = Object.freeze({
  cash_up: {
    domain: "cash_up",
    authority: "headline_management_sales",
    authoritativeFor: [
      "management_headline_net_sales",
      "official_management_sales_comparisons",
      "cash_up_covers",
      "cash_up_orders",
      "cash_up_avg_spend",
      "delivery_sales_in_cash_up",
    ],
    notAuthoritativeFor: ["basket_composition", "product_mix", "item_attach", "review_themes"],
    entities: ["branch_day", "period_aggregate"],
    metrics: ["net_sales", "covers", "orders", "avg_spend", "delivery_sales", "delta_pct"],
    dimensions: ["branch", "date", "period"],
    dateGrain: "day",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "structured_facts_coverage_per_branch",
    queryCapability: "commercial.performance",
    confidence: "high",
    joins: ["commerce", "reviews", "reception", "operations", "timeline"],
    knownUnavailable: ["weekend_native_filter", "product"],
    notes: "ask_nac_structured_facts report_type=cash_up. Never replaced by Foodics check totals.",
  },
  commerce: {
    domain: "commerce",
    authority: "canonical_order_basket",
    authoritativeFor: [
      "orders",
      "baskets",
      "items",
      "sessions",
      "product_associations",
      "check_composition",
      "order_grain_covers",
      "archetypes",
    ],
    notAuthoritativeFor: ["headline_management_sales"],
    entities: ["orders", "items", "sessions", "products"],
    metrics: [
      "average_check",
      "basket_item_count",
      "penetration_rate",
      "attach_rate",
      "lift_vs_baseline",
      "category_share",
    ],
    dimensions: ["branch", "date", "hour", "weekend", "product", "family", "guest_band"],
    dateGrain: "day",
    branchCoverage: ["khobar"],
    availablePeriods: "published_canonical_commerce_khobar",
    queryCapability: "commerce.semantic_query",
    confidence: "high",
    joins: ["cash_up", "menu", "calendar_events"],
    knownUnavailable: ["physical_table_number", "creator", "item_moved", "riyadh_jeddah_order_grain"],
    notes: "Canonical Foodics-derived orders/items/sessions. Check totals must not replace Cash Up sales.",
  },
  reviews: {
    domain: "reviews",
    authority: "logbook_google_star_counts",
    authoritativeFor: ["google_star_volume", "star_mix_from_logbook"],
    notAuthoritativeFor: ["headline_sales", "complaint_theme_taxonomy_if_unstructured"],
    entities: ["daily_review_counts"],
    metrics: ["google_review_1", "google_review_2", "google_review_3", "google_review_4", "google_review_5", "review_volume"],
    dimensions: ["branch", "date", "star"],
    dateGrain: "day",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "days_with_daily_logbook_review_metrics",
    queryCapability: "guest.feedback",
    confidence: "medium",
    joins: ["cash_up", "operations"],
    knownUnavailable: ["free_text_theme_taxonomy_unless_present_in_logbook"],
    notes: "Google star counts from daily logbook structured facts / reception tools. Association only vs sales.",
  },
  reception: {
    domain: "reception",
    authority: "logbook_reception_tables",
    authoritativeFor: ["logbook_covers", "reservations", "walkins", "no_shows", "cancellations"],
    notAuthoritativeFor: ["cash_up_covers", "7rooms_native_api"],
    entities: ["reception_day"],
    metrics: ["covers", "reservations", "walkins", "no_shows", "cancellations"],
    dimensions: ["branch", "date"],
    dateGrain: "day",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "days_with_logbook_or_reception_reports",
    queryCapability: "operations.review",
    confidence: "medium",
    joins: ["cash_up", "operations"],
    knownUnavailable: ["7rooms_api", "table_assignment"],
    notes: "Reception metrics from ingested logbook/reception PDFs, not a live 7Rooms feed.",
  },
  operations: {
    domain: "operations",
    authority: "operational_recorded_evidence",
    authoritativeFor: ["logbook_issues", "in_range_operational_notes"],
    notAuthoritativeFor: ["headline_sales"],
    entities: ["logbook_day", "issue"],
    metrics: ["issue_mentions"],
    dimensions: ["branch", "date"],
    dateGrain: "day",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "days_with_daily_logbook",
    queryCapability: "operations.review",
    confidence: "medium",
    joins: ["cash_up", "reviews", "vault"],
    knownUnavailable: ["staff_identity_performance_grain"],
    notes: "Qualitative operational evidence. Does not override Cash Up.",
  },
  vault: {
    domain: "vault",
    authority: "structured_document_facts",
    authoritativeFor: ["ingested_structured_facts", "management_report_facts_when_parsed"],
    notAuthoritativeFor: ["unstructured_vector_guesses"],
    entities: ["document", "structured_fact"],
    metrics: ["fact_value"],
    dimensions: ["branch", "date", "report_type"],
    dateGrain: "day",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "ingested_vault_files",
    queryCapability: "operations.review",
    confidence: "partial",
    joins: ["operations", "timeline"],
    knownUnavailable: ["free_form_embedding_search_as_fact"],
    notes: "Use structured Vault/query tools first. Unstructured excerpts are labeled low confidence.",
  },
  menu: {
    domain: "menu",
    authority: "catalogue_identity",
    authoritativeFor: ["item_identity", "section", "branch_menu_presence"],
    notAuthoritativeFor: ["launch_date_unless_timeline_or_vault_fact", "exposure_impressions"],
    entities: ["menu_item"],
    metrics: ["availability_flag"],
    dimensions: ["branch", "section", "item"],
    dateGrain: "item",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "current_catalogue_not_a_dated_event_log",
    queryCapability: "menu.performance",
    confidence: "partial",
    joins: ["commerce"],
    knownUnavailable: ["impression_visibility", "guaranteed_launch_timestamp"],
    notes: "Catalogue exists. Launch/cutover dates are only used when present on the timeline or a structured Vault fact.",
  },
  timeline: {
    domain: "timeline",
    authority: "company_historical",
    authoritativeFor: ["branch_opening", "trusted_structural_events"],
    notAuthoritativeFor: ["daily_sales"],
    entities: ["timeline_event"],
    metrics: ["opening_date"],
    dimensions: ["branch"],
    dateGrain: "event",
    branchCoverage: ["khobar"],
    availablePeriods: "trusted_config_events",
    queryCapability: "company.branch_timeline",
    confidence: "high",
    joins: ["cash_up", "calendar_events"],
    knownUnavailable: ["unregistered_menu_launches"],
    notes: "Khobar opened 2025-04-27. Do not invent other event dates.",
  },
  calendar_events: {
    domain: "calendar_events",
    authority: "named_event_calendar",
    authoritativeFor: ["founding_day_window", "named_holiday_windows_in_event_engine"],
    notAuthoritativeFor: ["ad_hoc_marketing_launches"],
    entities: ["holiday_window"],
    metrics: [],
    dimensions: ["event", "year"],
    dateGrain: "event",
    branchCoverage: ["khobar", "riyadh", "jeddah"],
    availablePeriods: "gregorian_holiday_registry_plus_temporal_parser",
    queryCapability: "calendar.resolve_period",
    confidence: "high",
    joins: ["cash_up", "commerce"],
    knownUnavailable: ["unregistered_brand_campaigns"],
    notes: "Founding Day and parser-supported named periods only. Unknown events stay unresolved.",
  },
}) as Record<DomainId, DomainRegistryEntry>;

export function listRegisteredDomains(): DomainId[] {
  return Object.keys(DOMAIN_REGISTRY) as DomainId[];
}

export function getDomain(id: string): DomainRegistryEntry | null {
  return DOMAIN_REGISTRY[id as DomainId] || null;
}

export function authorityForMetric(metric: string): DomainId | null {
  const m = String(metric || "").toLowerCase();
  if (/\b(net_sales|headline|management sales)\b/.test(m) || m === "sales") return "cash_up";
  if (/\b(basket|attach|mix|average_check|item)\b/.test(m) || /attach/.test(m)) return "commerce";
  if (/\breview|star|complaint\b/.test(m)) return "reviews";
  if (/\breservation|walkin|no_show\b/.test(m)) return "reception";
  return null;
}
