import { supabase } from "./supabase";
import { applyBranchScopeToSupabaseQuery, filterRowsByRbacProfile, resolveRbacQueryBranch } from "./rbacQueryScope";
import { runInventoryTruthEngine } from "../inventory/truth";
import {
  INGREDIENT_SELECT,
  LINE_SELECT,
  readCanonicalCommerceSales,
  RECIPE_SELECT,
  VERSION_SELECT,
} from "../inventory/truth/readers";
import {
  COMMERCE_CANDIDATE_TABLES,
  COMMERCE_ITEM_SELECT,
  SALES_SOURCE,
  SALES_SOURCE_STATUS,
  clipSalesPeriod,
  reconcileSalesSources,
  selectSalesSource,
} from "../inventory/truth/salesSource";

const COST_STATE_SELECT = "branch_id,ingredient_id,weighted_average_cost,last_purchase_price,last_purchase_at,current_quantity";
const CATALOGUE_SELECT = "id,ingredient_id,supplier_sku,original_product_name,verification_state";
const SALES_SELECT = "matched_menu_item_id,matched_menu_item_name,raw_item_name,normalized_item_name,quantity_sold,net_sales,branch_id,period_start,period_end";
const COMMERCE_FRESHNESS_SELECT = "dataset,branch_id,data_through,status";
const COMMERCE_HEALTH_SELECT = "branch_id,coverage_through,last_success_date,report_type";

const NETWORK_VAULT_ROLES = new Set(["ceo", "super_admin", "ops_manager"]);

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

async function unwrap(request, context) {
  const { data, error } = await request;
  if (error) throw new Error(`${context}: ${error.message}`);
  return data;
}

export function clampInventoryTruthBranch({ requestedBranch, access, rbacProfile } = {}) {
  if (rbacProfile?.authenticated && !rbacProfile.allBranches) {
    return rbacProfile.branchScope || null;
  }
  if (rbacProfile?.allBranches || (access?.vaultRole && NETWORK_VAULT_ROLES.has(access.vaultRole))) {
    return requestedBranch || null;
  }
  const allowed = access?.branchIds || [];
  if (requestedBranch && allowed.includes(requestedBranch)) return requestedBranch;
  return access?.primaryBranchId || allowed[0] || null;
}

export function canViewInventoryTruthDiagnostics({ access, rbacProfile } = {}) {
  if (rbacProfile?.role === "developer" || rbacProfile?.allBranches) return true;
  return NETWORK_VAULT_ROLES.has(access?.vaultRole);
}

function applyBranch(query, { branchId, rbacProfile, column = "branch_id" }) {
  let next = query;
  if (branchId) next = next.eq(column, branchId);
  else next = applyBranchScopeToSupabaseQuery(next, rbacProfile, column);
  return next;
}

export function inventoryIngredientBranchFilter(branchId) {
  if (!branchId) return { mode: "network", or: null };
  return {
    mode: "branch_plus_network",
    or: `branch_id.is.null,branch_id.eq.${branchId}`,
  };
}

function isMissingRelation(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01"
    || code === "PGRST205"
    || message.includes("does not exist")
    || message.includes("schema cache")
    || message.includes("could not find the table");
}

export async function fetchInventoryTruthFoundation({
  branchId = null,
  access = null,
  rbacProfile = null,
} = {}) {
  const clamped = clampInventoryTruthBranch({ requestedBranch: branchId, access, rbacProfile });
  const client = requireClient();
  const ingredientQuery = client.from("inventory_ingredients").select(INGREDIENT_SELECT);
  const recipeQuery = client.from("inventory_recipes").select(RECIPE_SELECT);
  const ingredientScope = inventoryIngredientBranchFilter(clamped);
  const [ingredients, recipes, versions, lines, costState, catalogue, movementProbe, countProbe] = await Promise.all([
    unwrap(
      ingredientScope.or ? ingredientQuery.or(ingredientScope.or) : ingredientQuery,
      "Fetch inventory ingredients",
    ),
    unwrap(
      clamped
        ? recipeQuery.or(`branch_id.is.null,branch_id.eq.${clamped}`)
        : recipeQuery,
      "Fetch inventory recipes",
    ),
    unwrap(client.from("inventory_recipe_versions").select(VERSION_SELECT), "Fetch recipe versions"),
    unwrap(client.from("inventory_recipe_version_lines").select(LINE_SELECT), "Fetch recipe lines"),
    unwrap(
      applyBranch(
        client.from("inventory_ingredient_cost_state").select(COST_STATE_SELECT),
        { branchId: clamped, rbacProfile },
      ),
      "Fetch ingredient cost state",
    ),
    unwrap(client.from("inventory_supplier_catalogue_items").select(CATALOGUE_SELECT), "Fetch supplier catalogue"),
    client.from("inventory_movements").select("id", { count: "exact", head: true }).limit(1),
    client.from("inventory_stock_counts").select("id", { count: "exact", head: true }).eq("status", "posted").limit(1),
  ]);

  const movementCount = movementProbe.error ? null : Number(movementProbe.count || 0);
  const postedCountCount = countProbe.error ? null : Number(countProbe.count || 0);

  const scopedCostState = filterRowsByRbacProfile(rbacProfile, costState || []);
  const costStateByIngredientId = {};
  const costRowsByIngredient = new Map();
  for (const row of scopedCostState) {
    if (!costRowsByIngredient.has(row.ingredient_id)) costRowsByIngredient.set(row.ingredient_id, []);
    costRowsByIngredient.get(row.ingredient_id).push(row);
  }
  for (const [ingredientId, rows] of costRowsByIngredient.entries()) {
    const match = clamped ? rows.find((row) => row.branch_id === clamped) : (rows.length === 1 ? rows[0] : null);
    if (match) costStateByIngredientId[ingredientId] = match;
  }

  return {
    branchId: clamped,
    ingredients: ingredients || [],
    recipes: recipes || [],
    versions: versions || [],
    lines: lines || [],
    catalogueItems: (catalogue || []).map((row) => ({
      id: row.id,
      ingredientId: row.ingredient_id,
      supplierSku: row.supplier_sku,
      originalProductName: row.original_product_name,
      verificationState: row.verification_state,
    })),
    costStateByIngredientId,
    movements: [],
    stockCounts: [],
    sourcePresence: {
      movements: movementCount == null ? "unavailable" : movementCount > 0 ? "present" : "empty",
      postedStockCounts: postedCountCount == null ? "unavailable" : postedCountCount > 0 ? "present" : "empty",
    },
  };
}

async function probeCommerceCoverage(client, { branchId, rbacProfile }) {
  const freshnessQuery = applyBranch(
    client.from(COMMERCE_CANDIDATE_TABLES.freshness).select(COMMERCE_FRESHNESS_SELECT),
    { branchId, rbacProfile },
  );
  const healthQuery = applyBranch(
    client.from(COMMERCE_CANDIDATE_TABLES.ingestHealth).select(COMMERCE_HEALTH_SELECT),
    { branchId, rbacProfile },
  );
  const [freshness, health] = await Promise.all([freshnessQuery, healthQuery]);
  const freshnessMissing = freshness.error && isMissingRelation(freshness.error);
  const healthMissing = health.error && isMissingRelation(health.error);
  const dates = [
    ...(freshness.data || []).map((row) => row.data_through).filter(Boolean),
    ...(health.data || []).map((row) => row.coverage_through || row.last_success_date).filter(Boolean),
  ].sort();
  return {
    publishedThrough: dates.length ? dates[dates.length - 1] : null,
    freshnessStatus: freshnessMissing ? SALES_SOURCE_STATUS.NOT_IN_SCHEMA : (freshness.error ? SALES_SOURCE_STATUS.UNAVAILABLE : SALES_SOURCE_STATUS.AVAILABLE),
    healthStatus: healthMissing ? SALES_SOURCE_STATUS.NOT_IN_SCHEMA : (health.error ? SALES_SOURCE_STATUS.UNAVAILABLE : SALES_SOURCE_STATUS.AVAILABLE),
  };
}

async function probeCommerceItems(client, { branchId, rbacProfile, availableStart, availableEnd }) {
  if (!availableStart || !availableEnd) {
    return { status: SALES_SOURCE_STATUS.EMPTY, rows: [], complete: true, table: COMMERCE_CANDIDATE_TABLES.items };
  }
  // Shared ordered pager: source-filtered, order-status gated, complete only after an empty page.
  const read = await readCanonicalCommerceSales(client, {
    branchId,
    start: availableStart,
    end: availableEnd,
    applyScope: (query) => applyBranchScopeToSupabaseQuery(query, rbacProfile),
  });
  if (read.error) {
    if (isMissingRelation(read.error)) {
      return { status: SALES_SOURCE_STATUS.NOT_IN_SCHEMA, rows: [], complete: true, table: COMMERCE_CANDIDATE_TABLES.items };
    }
    throw new Error(`Fetch canonical commerce order items: ${read.error.message || read.error}`);
  }
  // Negative (refund) rows stay in: the truth ledger nets them per menu item, as before.
  const rows = read.rows;
  return {
    status: read.rawRowCount ? SALES_SOURCE_STATUS.AVAILABLE : SALES_SOURCE_STATUS.EMPTY,
    rows,
    complete: read.complete,
    droppedRows: read.droppedRows,
    refunds: read.refunds,
    orderStatusVerified: read.orderStatusVerified,
    incompleteReason: read.reason || null,
    table: COMMERCE_CANDIDATE_TABLES.items,
  };
}

async function fetchManualFoodicsItems(client, { branchId, rbacProfile, availableStart, availableEnd }) {
  if (!availableStart || !availableEnd) return [];
  let query = client
    .from("foodics_sales_items")
    .select(SALES_SELECT)
    .lte("period_start", availableEnd)
    .gte("period_end", availableStart);
  if (branchId) query = query.eq("branch_id", branchId);
  else query = applyBranchScopeToSupabaseQuery(query, rbacProfile);
  return filterRowsByRbacProfile(
    rbacProfile,
    await unwrap(query, "Fetch fallback Foodics item imports"),
  );
}

export async function fetchInventoryTruthSales({
  branchId = null,
  periodStart,
  periodEnd,
  access = null,
  rbacProfile = null,
  referenceDate = new Date(),
} = {}) {
  const clamped = clampInventoryTruthBranch({ requestedBranch: branchId, access, rbacProfile });
  if (!periodStart || !periodEnd) {
    return {
      rows: [],
      branchId: clamped,
      periodStart,
      periodEnd,
      used: SALES_SOURCE.NONE,
      coverageNote: "Period required",
    };
  }
  const client = requireClient();
  const coverageProbe = await probeCommerceCoverage(client, { branchId: clamped, rbacProfile });
  const clipped = clipSalesPeriod({
    requestedStart: periodStart,
    requestedEnd: periodEnd,
    publishedThrough: coverageProbe.publishedThrough,
    referenceDate,
  });
  const commerceProbe = await probeCommerceItems(client, {
    branchId: clamped,
    rbacProfile,
    availableStart: clipped.availableStart,
    availableEnd: clipped.availableEnd,
  });
  const foodicsRows = await fetchManualFoodicsItems(client, {
    branchId: clamped,
    rbacProfile,
    availableStart: clipped.availableStart,
    availableEnd: clipped.availableEnd,
  });
  const coversRequestedPeriod = Boolean(
    clipped.usable
    && coverageProbe.publishedThrough
    && clipped.availableEnd
    && coverageProbe.publishedThrough >= clipped.availableEnd,
  );
  const selected = selectSalesSource({
    commerceProbe,
    foodicsRows,
    coversRequestedPeriod,
  });
  const reconciliation = commerceProbe.status !== SALES_SOURCE_STATUS.NOT_IN_SCHEMA && foodicsRows.length
    ? reconcileSalesSources(selected.used === SALES_SOURCE.CANONICAL_COMMERCE ? selected.rows : commerceProbe.rows, foodicsRows)
    : { compared: false, combined: false };
  return {
    rows: selected.rows,
    branchId: clamped || resolveRbacQueryBranch(rbacProfile, branchId),
    periodStart: clipped.availableStart || periodStart,
    periodEnd: clipped.availableEnd || periodEnd,
    requestedStart: periodStart,
    requestedEnd: periodEnd,
    used: selected.used,
    primary: selected.primary,
    fallback: selected.fallback,
    combined: false,
    coverage: clipped,
    commerceStatus: commerceProbe.status,
    commerceComplete: commerceProbe.complete !== false,
    commerceIncompleteReason: commerceProbe.incompleteReason || null,
    commerceDroppedRows: commerceProbe.droppedRows || null,
    commerceRefunds: commerceProbe.refunds || null,
    commerceOrderStatusVerified: commerceProbe.orderStatusVerified ?? null,
    publishedThrough: coverageProbe.publishedThrough,
    reconciliation,
  };
}

export function buildInventoryTruthResult(foundation, sales = {}) {
  return runInventoryTruthEngine({
    ingredients: foundation.ingredients,
    recipes: foundation.recipes,
    versions: foundation.versions,
    lines: foundation.lines,
    catalogueItems: foundation.catalogueItems,
    costStateByIngredientId: foundation.costStateByIngredientId,
    salesRows: sales.rows || [],
    movements: foundation.movements || [],
    stockCounts: foundation.stockCounts || [],
    movementPresence: foundation.sourcePresence?.movements || null,
    postedCountPresence: foundation.sourcePresence?.postedStockCounts || null,
    salesSource: sales.used || sales.source || null,
    salesCoverage: sales.coverage || null,
    branchId: foundation.branchId,
    periodStart: sales.periodStart || null,
    periodEnd: sales.periodEnd || null,
  });
}

export const INVENTORY_TRUTH_SELECTS = Object.freeze({
  INGREDIENT_SELECT,
  RECIPE_SELECT,
  VERSION_SELECT,
  LINE_SELECT,
  COST_STATE_SELECT,
  CATALOGUE_SELECT,
  SALES_SELECT,
  COMMERCE_ITEM_SELECT,
  COMMERCE_FRESHNESS_SELECT,
  COMMERCE_HEALTH_SELECT,
});
