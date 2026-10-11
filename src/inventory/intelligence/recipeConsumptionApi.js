import { consumptionQuestionFor, parseConsumptionQuestion, resolveConsumptionWindow } from "./consumptionEvidence";
import { summarizeIngredientConsumptionWithTruth } from "../truth/ingredientConsumption";
import {
  isMissingRelationError,
  readCanonicalCommerceSales,
  readLegacyFoodicsSales,
  readRecipeGraphInputs,
} from "../truth/readers";
import { CANONICAL_COMMERCE_SOURCE } from "../truth/salesSource";
import { canProfileReadBranch } from "../../lib/rbacIntelligenceScope";
import { FOODICS_RECIPE_EXPORT_AS_OF, recoveredEvidenceForIngredient } from "./foodicsRecipeRecovery";

/**
 * Compatibility wrapper: canonical commerce read through the shared ordered pager.
 * Rows are source-filtered and order-status gated; `complete` is true only after
 * an empty page.
 */
export async function pageCommerceSales(supabase, branch, window, { pageSize = 1000, maxPages = 50 } = {}) {
  const read = await readCanonicalCommerceSales(supabase, {
    branchId: branch,
    start: window.start,
    end: window.end,
    pageSize,
    maxPages,
  });
  return {
    error: read.error || null,
    rows: read.rows,
    complete: read.complete,
    rawRowCount: read.rawRowCount ?? 0,
    droppedRows: read.droppedRows,
    refunds: read.refunds,
    orderStatusVerified: read.orderStatusVerified,
    reason: read.reason || null,
  };
}

async function readPublishedThrough(supabase, branch) {
  const fresh = await supabase
    .from("commerce_dataset_freshness")
    .select("data_through")
    .eq("branch_id", branch)
    .eq("dataset", "order_items")
    .order("data_through", { ascending: false })
    .limit(1);
  if (fresh.error) return { publishedThrough: null, known: false, note: "the freshness record could not be read" };
  const publishedThrough = fresh.data?.[0]?.data_through || null;
  return {
    publishedThrough,
    known: Boolean(publishedThrough),
    note: publishedThrough ? null : "no freshness record exists for this branch",
  };
}

/**
 * Load sales for the window. Canonical commerce is authoritative; the legacy
 * manual import is used only when the commerce tables do not exist.
 */
export async function loadAuthoritativeSales(supabase, branch, window, options = {}) {
  const commerce = await readCanonicalCommerceSales(supabase, {
    branchId: branch,
    start: window.start,
    end: window.end,
    source: CANONICAL_COMMERCE_SOURCE,
    ...options,
  });
  if (!commerce.error) return commerce;
  if (!isMissingRelationError(commerce.error)) throw commerce.error;
  const legacy = await readLegacyFoodicsSales(supabase, { branchId: branch, start: window.start, end: window.end, ...options });
  if (legacy.error) throw legacy.error;
  let latestSalesDate = null;
  if (!legacy.rows.length) {
    const latest = await supabase
      .from("foodics_sales_items")
      .select("period_end")
      .eq("branch_id", branch)
      .order("period_end", { ascending: false })
      .limit(1);
    latestSalesDate = latest.data?.[0]?.period_end || null;
  }
  return {
    ...legacy,
    latestSalesDate,
    orderStatusVerified: true,
    droppedRows: { total: 0, byReason: {} },
    refunds: { rows: 0, unnetted: 0 },
  };
}

function resolveNow({ now, today }) {
  if (now) return now instanceof Date ? now : new Date(now);
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(String(today))) return new Date(`${today}T12:00:00+03:00`);
  return new Date();
}

/**
 * Read-only. Theoretical consumption of one ingredient for one branch and
 * period, computed by the canonical Inventory Truth engine.
 * A recipe is linked to sales only by the menu-item id stored on the recipe.
 */
export async function queryIngredientConsumption(supabase, {
  question,
  profile = null,
  now = null,
  today = null,
} = {}) {
  const parsed = parseConsumptionQuestion(question);
  if (!parsed) return null;
  const instant = resolveNow({ now, today });
  if (!parsed.branch || !parsed.period) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      reason: "Name the branch and the period: yesterday, last week, on YYYY-MM-DD, or from YYYY-MM-DD to YYYY-MM-DD.",
    };
  }
  // Fail closed (Oracle D1.1 R2): a missing/unauthenticated profile, or a branch
  // outside branchScope / allowedBranchIds, is refused before any read.
  if (!canProfileReadBranch(profile, parsed.branch)) {
    return { status: "UNAVAILABLE", postsStock: false, quantity: null, reason: "This account cannot read that branch." };
  }
  const freshness = await readPublishedThrough(supabase, parsed.branch);
  const window = resolveConsumptionWindow(parsed.period, { now: instant, publishedThrough: freshness.publishedThrough });
  if (!window) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId: parsed.branch,
      reason: "That date range is not valid (dates must be real YYYY-MM-DD dates, start on or before end, at most 62 days).",
    };
  }
  const ingredientName = parsed.ingredient || "";
  const { data: ingredients, error: ingredientError } = ingredientName
    ? await supabase
      .from("inventory_ingredients")
      .select("id, canonical_name, base_inventory_unit")
      .eq("active", true)
      .ilike("canonical_name", `%${ingredientName}%`)
      .order("id", { ascending: true })
      .limit(8)
    : { data: [], error: null };
  if (ingredientError) throw ingredientError;
  if (!ingredients?.length) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId: parsed.branch,
      periodLabel: window?.label || null,
      reason: ingredientName ? `No active ingredient is named like “${ingredientName}”.` : "No single ingredient was named.",
    };
  }
  const named = ingredients.map((item) => ({ id: item.id, name: item.canonical_name, baseUom: item.base_inventory_unit || null }));
  const ingredient = named.length === 1 ? named[0] : null;
  if (!ingredient || !window || window.status === "UNAVAILABLE") {
    const refused = summarizeIngredientConsumptionWithTruth({
      ingredient: ingredient || named[0],
      ingredients: named,
      branchId: parsed.branch,
      window,
    });
    if (window?.availableWindow && parsed.ingredient) {
      // R3: a follow-up the parser accepts (round-trip tested).
      refused.suggestedQuestion = consumptionQuestionFor({
        ingredient: parsed.ingredient,
        branch: parsed.branch,
        start: window.availableWindow.start,
        end: window.availableWindow.end,
      });
      refused.reason = `${refused.reason} Try: “${refused.suggestedQuestion}”`;
    }
    return refused;
  }
  const sales = await loadAuthoritativeSales(supabase, parsed.branch, window);
  const graphInput = await readRecipeGraphInputs(supabase, { branchId: parsed.branch });
  if (graphInput.error) throw graphInput.error;
  if (!graphInput.complete) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId: parsed.branch,
      periodLabel: window.label,
      ingredient: ingredient.name,
      reason: "The Food Bible recipe read stopped before it was finished. No total is shown.",
    };
  }
  const exportApplies = window.start >= FOODICS_RECIPE_EXPORT_AS_OF;
  const summary = summarizeIngredientConsumptionWithTruth({
    ingredient,
    ingredients: named,
    branchId: parsed.branch,
    window,
    salesRows: sales.rows,
    graphInput,
    sales: {
      complete: sales.complete,
      source: sales.source,
      latestSalesDate: freshness.publishedThrough || sales.latestSalesDate || null,
      droppedRows: sales.droppedRows,
      refunds: sales.refunds,
      orderStatusVerified: sales.orderStatusVerified,
      unsplittableRows: sales.unsplittableRows || 0,
      reason: sales.reason,
      // R6: unreadable or missing publication freshness downgrades PROVISIONAL.
      publicationVerified: freshness.known,
      publicationNote: freshness.note,
    },
    recoveredEvidence: exportApplies
      ? recoveredEvidenceForIngredient(sales.rows, ingredient.name)
      : { links: [], excluded: [] },
  });
  const notes = [];
  if (!freshness.known) notes.push(`Publication freshness is unknown (${freshness.note}); only the 08:00 AST business-day cutoff was applied.`);
  if (!exportApplies) notes.push(`The recovered Foodics recipe export is dated ${FOODICS_RECIPE_EXPORT_AS_OF} and has no effective date covering ${window.start}.`);
  if (notes.length) summary.reason = `${summary.reason} ${notes.join(" ")}`;
  return summary;
}
