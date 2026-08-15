import type { CommerceFocus } from "./types.ts";
import { intersectCoverage, type CoverageWindow } from "./freshness.ts";

export type CapabilityRequirement = {
  capability: string;
  datasets: string[];
  publicationGroup?: string;
  maxUnclassified?: number;
};

export const CAPABILITY_REQUIREMENTS: Record<string, CapabilityRequirement> = {
  "commerce.session_mix": {
    capability: "commerce.session_mix",
    datasets: ["orders", "order_items", "product_mapping"],
    publicationGroup: "commerce_sessions",
    maxUnclassified: 0.35,
  },
  "commerce.item_mix": {
    capability: "commerce.item_mix",
    datasets: ["order_items", "product_mapping"],
  },
  "commerce.orders_count": {
    capability: "commerce.orders_count",
    datasets: ["orders"],
  },
  "commerce.dessert_conversion": {
    capability: "commerce.dessert_conversion",
    datasets: ["orders", "order_items", "product_mapping"],
    publicationGroup: "commerce_sessions",
    maxUnclassified: 0.35,
  },
  "commercial.sales": {
    capability: "commercial.sales",
    datasets: ["cash_up"],
  },
};

export function requirementsForFocus(focus: CommerceFocus): CapabilityRequirement | null {
  if (focus === "item_mix" || focus === "rank_items") return CAPABILITY_REQUIREMENTS["commerce.item_mix"];
  if (focus === "dessert_conversion") return CAPABILITY_REQUIREMENTS["commerce.dessert_conversion"];
  if (focus === "freshness" || focus === "health" || focus === "data_used") return null;
  if (!focus) return null;
  return CAPABILITY_REQUIREMENTS["commerce.session_mix"];
}

export function evaluateCapabilityReadiness(input: {
  capability: string;
  available: Record<string, boolean>;
  unclassifiedRate?: number | null;
  coverage?: CoverageWindow[];
}): { ready: boolean; missing: string[]; commonThrough: string | null; mismatchedCoverage: boolean } {
  const req = CAPABILITY_REQUIREMENTS[input.capability];
  if (!req) return { ready: false, missing: ["unknown_capability"], commonThrough: null, mismatchedCoverage: false };
  const missing = req.datasets.filter((d) => !input.available[d]);
  if (req.maxUnclassified != null && input.unclassifiedRate != null && input.unclassifiedRate >= req.maxUnclassified) {
    missing.push("mapping_quality");
  }
  const coverage = intersectCoverage(input.coverage || []);
  return {
    ready: missing.length === 0,
    missing,
    commonThrough: coverage.commonThrough,
    mismatchedCoverage: coverage.mismatched,
  };
}
