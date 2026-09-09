import { CONVERSION_STATUS, GRAPH_STATUS } from "./contracts";
import { isVerificationFixture, requiresKitchenRecipe } from "../foodBible";
import { normalizeIdentityName } from "../../dashboard/health/identityClusters";
import { aggregateSalesDrivers, computeTheoreticalLedger } from "./consumption";
import { buildRecipeGraph, expandRecipeToIngredients, selectAnalyticalVersion } from "./recipeGraph";
import { resolveRecipeLineUom } from "./uom";
import {
  ACTIVATION_DECISION,
  COMMERCE_IDENTITY_CLASS,
  PURCHASE_EVIDENCE_CLASS,
  RECIPE_VERSION_CLASS,
} from "./readinessContracts";

export {
  ACTIVATION_DECISION,
  COMMERCE_IDENTITY_CLASS,
  PURCHASE_EVIDENCE_CLASS,
  RECIPE_VERSION_CLASS,
  RECIPE_VERSION_LIFECYCLE,
} from "./readinessContracts";

const DOCUMENTATION_LINE = /^(total|portions?|finished weight|fin?ished weight|bases|except the olive oil,?)$/i;
const PACK_UNIT = /^(case|box|bag|bottle|btl|pack|carton|tin|can)$/i;

function statusOf(version) {
  return String(version?.status || "").toLowerCase();
}

function recipeName(recipe) {
  return recipe?.name || recipe?.name_en || recipe?.nameEn || recipe?.id || "";
}

function linesForVersion(lines, versionId) {
  return (lines || []).filter((line) => (line.recipe_version_id || line.recipeVersionId) === versionId);
}

function isDocumentationArtifact(ingredientName) {
  return DOCUMENTATION_LINE.test(String(ingredientName || "").trim());
}

function graphWithForcedVersion(graph, recipeId, version, lines) {
  const recipeIndex = new Map(graph.recipeIndex);
  const node = recipeIndex.get(recipeId);
  if (!node) return graph;
  recipeIndex.set(recipeId, {
    ...node,
    version,
    versionStatus: GRAPH_STATUS.OK,
    lines,
  });
  return { ...graph, recipeIndex };
}

function blockingIssue(issue) {
  const code = issue?.code;
  return code && code !== GRAPH_STATUS.OK && code !== "YIELD_UNKNOWN";
}

function addDecimalString(left, right) {
  return String(Number(left || 0) + Number(right || 0));
}

export function proposeActivateRecipeVersion({ recipeId, activateVersionId, versions = [] } = {}) {
  const currentActive = (versions || []).filter((version) => (
    version.recipe_id === recipeId && statusOf(version) === "active" && version.id !== activateVersionId
  ));
  return {
    recipeId,
    activateVersionId,
    retireVersionIds: currentActive.map((version) => version.id),
    executed: false,
    writes: [
      { table: "inventory_recipe_versions", id: activateVersionId, patch: { status: "active" } },
      ...currentActive.map((version) => ({
        table: "inventory_recipe_versions",
        id: version.id,
        patch: { status: "retired" },
      })),
    ],
  };
}

function soldForRecipe({ recipe, menuItems, salesRows }) {
  const menuId = recipe.menu_item_id || recipe.menuItemId || null;
  const drivers = aggregateSalesDrivers(salesRows);
  const nameKey = normalizeIdentityName(recipeName(recipe));
  let soldQuantity = "0";
  let netSales = null;
  let soldRows = 0;
  let displayName = recipeName(recipe);
  for (const driver of drivers) {
    const menu = (menuItems || []).find((item) => item.id === driver.menuItemId);
    const matchesId = Boolean(menuId && driver.menuItemId === menuId);
    const matchesName = Boolean(nameKey && normalizeIdentityName(driver.displayName) === nameKey);
    const matchesMenuName = Boolean(menu && nameKey && normalizeIdentityName(menu.name_en || menu.name) === nameKey);
    if (!matchesId && !matchesName && !matchesMenuName) continue;
    soldQuantity = addDecimalString(soldQuantity, driver.soldQuantity);
    soldRows += driver.soldRows;
    displayName = driver.displayName || displayName;
    if (driver.mappedRevenue != null) {
      netSales = netSales == null ? Number(driver.mappedRevenue) : netSales + Number(driver.mappedRevenue);
    }
  }
  return { soldQuantity, netSales: netSales == null ? null : String(netSales), soldRows, displayName };
}

export function classifyBlockedRecipe({
  recipe,
  versions = [],
  allRecipes = [],
  allVersions = [],
  lines = [],
  ingredients = [],
  menuItems = [],
  salesRows = [],
} = {}) {
  const sales = soldForRecipe({ recipe, menuItems, salesRows });
  const selected = selectAnalyticalVersion(versions);
  const ingredientById = new Map((ingredients || []).map((row) => [row.id, row]));
  const drafts = versions.filter((version) => statusOf(version) === "draft");
  const draftsWithLines = drafts.filter((version) => linesForVersion(lines, version.id).length);
  const retired = versions.filter((version) => statusOf(version) === "retired");
  const kitchen = requiresKitchenRecipe({ name: recipeName(recipe) });
  const base = {
    recipeId: recipe.id,
    recipeName: recipeName(recipe),
    recipeType: recipe.recipe_type || recipe.recipeType,
    menuItemId: recipe.menu_item_id || recipe.menuItemId || null,
    branchId: recipe.branch_id || null,
    soldQuantity: sales.soldQuantity,
    netSales: sales.netSales,
    soldDisplayName: sales.displayName,
    candidate: null,
    structuralIssues: [],
    class: RECIPE_VERSION_CLASS.TRUE_RECIPE_MISSING,
    decision: ACTIVATION_DECISION.DO_NOT_ACTIVATE,
    reason: "No plausible recipe version",
  };

  if (selected.status === GRAPH_STATUS.OK) {
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.ANALYTICAL_OK,
      decision: ACTIVATION_DECISION.DO_NOT_ACTIVATE,
      reason: "Already has an analytical OK version",
    };
  }
  if (!kitchen && (recipe.recipe_type === "menu_item" || recipe.recipeType === "menu_item")) {
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.NON_KITCHEN_FALSE_POSITIVE,
      reason: "Beverage/retail/modifier — not a kitchen recipe activation",
    };
  }
  if (recipe.active === false || (retired.length && !drafts.length)) {
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.LEGACY_STALE_ONLY,
      reason: "Inactive recipe or retired-only versions",
    };
  }
  if (draftsWithLines.length > 1) {
    const latest = draftsWithLines[draftsWithLines.length - 1];
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.MULTIPLE_DRAFT_CANDIDATES,
      decision: ACTIVATION_DECISION.REVIEW_REQUIRED,
      candidate: {
        versionId: latest.id,
        versionNumber: latest.version_number,
        status: "draft",
        createdAt: latest.created_at || null,
        updatedAt: latest.updated_at || null,
      },
      reason: `${draftsWithLines.length} draft versions contain lines`,
    };
  }

  const candidate = draftsWithLines[0] || drafts[0] || null;
  if (!candidate) {
    return { ...base, class: RECIPE_VERSION_CLASS.TRUE_RECIPE_MISSING, reason: "No draft or active version to evaluate" };
  }

  const candidateLines = linesForVersion(lines, candidate.id);
  const artifactLines = candidateLines.filter((line) => {
    const ingredient = ingredientById.get(line.ingredient_id || line.ingredientId);
    return isDocumentationArtifact(ingredient?.canonical_name || ingredient?.canonicalName);
  });
  const realLines = candidateLines.filter((line) => !artifactLines.includes(line));
  if (!realLines.length || artifactLines.length > realLines.length) {
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.BROKEN_RECIPE,
      candidate: {
        versionId: candidate.id,
        versionNumber: candidate.version_number,
        status: statusOf(candidate),
        createdAt: candidate.created_at || null,
        updatedAt: candidate.updated_at || null,
      },
      structuralIssues: artifactLines.map((line) => ({
        code: GRAPH_STATUS.INVALID_QUANTITY,
        lineId: line.id,
        reason: "documentation_artifact",
      })),
      reason: "Version lines are documentation artifacts or empty",
    };
  }

  const graph = buildRecipeGraph({
    recipes: allRecipes.length ? allRecipes : [recipe],
    versions: allVersions.length ? allVersions : versions,
    lines,
    ingredients,
  });
  const forced = graphWithForcedVersion(graph, recipe.id, candidate, candidateLines);
  const expansion = expandRecipeToIngredients({ recipeId: recipe.id, outputNeeded: "1", graph: forced });
  const uomIssues = [];
  for (const line of realLines) {
    if (line.sub_recipe_id || line.subRecipeId) continue;
    const ingredient = ingredientById.get(line.ingredient_id || line.ingredientId);
    const resolved = resolveRecipeLineUom({
      quantity: line.quantity,
      unit: line.unit,
      baseUom: ingredient?.base_inventory_unit || ingredient?.baseInventoryUnit,
    });
    if (resolved.conversionStatus === CONVERSION_STATUS.INCOMPATIBLE || resolved.conversionStatus === CONVERSION_STATUS.MISSING_CONVERSION) {
      uomIssues.push({ code: resolved.conversionStatus, lineId: line.id, unit: line.unit });
    }
    if (!line.unit) uomIssues.push({ code: GRAPH_STATUS.MISSING_QUANTITY, lineId: line.id, reason: "missing_uom" });
  }
  const structuralIssues = [
    ...(expansion.issues || []).filter(blockingIssue),
    ...uomIssues,
    ...artifactLines.map((line) => ({
      code: GRAPH_STATUS.INVALID_QUANTITY,
      lineId: line.id,
      reason: "documentation_artifact",
    })),
  ];

  const candidateMeta = {
    versionId: candidate.id,
    versionNumber: candidate.version_number,
    status: statusOf(candidate),
    createdAt: candidate.created_at || null,
    updatedAt: candidate.updated_at || null,
  };

  const menuId = recipe.menu_item_id || recipe.menuItemId || null;
  const exactMenu = (menuItems || []).filter((item) => (
    item.active !== false
    && normalizeIdentityName(item.name_en || item.name) === normalizeIdentityName(recipeName(recipe))
  ));
  if (!menuId && (recipe.recipe_type === "menu_item" || recipe.recipeType === "menu_item") && exactMenu.length === 1) {
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.MENU_MAPPING_MISSING,
      decision: ACTIVATION_DECISION.REVIEW_REQUIRED,
      candidate: candidateMeta,
      structuralIssues,
      reason: "Recipe is structurally reviewable but menu_item_id is not linked",
    };
  }

  if (structuralIssues.length || artifactLines.length) {
    const brokenCodes = new Set([
      GRAPH_STATUS.CIRCULAR,
      GRAPH_STATUS.MISSING_SUB_RECIPE,
      GRAPH_STATUS.INVALID_QUANTITY,
      GRAPH_STATUS.MISSING_QUANTITY,
    ]);
    const broken = structuralIssues.some((issue) => brokenCodes.has(issue.code));
    return {
      ...base,
      class: broken && !sales.soldRows ? RECIPE_VERSION_CLASS.BROKEN_RECIPE : RECIPE_VERSION_CLASS.UNIQUE_CURRENT_DRAFT,
      decision: ACTIVATION_DECISION.REVIEW_REQUIRED,
      candidate: candidateMeta,
      structuralIssues,
      reason: structuralIssues[0]?.code || "Structural validation failed",
    };
  }

  if ((recipe.recipe_type === "menu_item" || recipe.recipeType === "menu_item") && !menuId) {
    return {
      ...base,
      class: RECIPE_VERSION_CLASS.UNIQUE_CURRENT_DRAFT,
      decision: ACTIVATION_DECISION.REVIEW_REQUIRED,
      candidate: candidateMeta,
      reason: "Unique draft is not tied to a live menu identity",
    };
  }

  return {
    ...base,
    class: RECIPE_VERSION_CLASS.UNIQUE_CURRENT_DRAFT,
    decision: ACTIVATION_DECISION.SAFE_TO_ACTIVATE,
    candidate: candidateMeta,
    structuralIssues: [],
    reason: "Unique current draft, deterministic menu link, structurally valid",
  };
}

export function classifyCommerceIdentity({ driver, salesRows = [], menuItems = [], branchId = null } = {}) {
  if (driver.menuItemId) {
    return {
      class: COMMERCE_IDENTITY_CLASS.ALREADY_MAPPED,
      displayName: driver.displayName,
      productId: driver.foodicsProductId || null,
      soldQuantity: driver.soldQuantity,
      proposedMenuItemId: driver.menuItemId,
      candidateMenuItemIds: [driver.menuItemId],
      reason: "canonical_menu_item_id already present",
    };
  }

  const productId = driver.foodicsProductId || driver.product_id || null;
  if (productId) {
    const linkedIds = [...new Set((salesRows || [])
      .filter((row) => (row.foodics_product_id || row.product_id) === productId && (row.matched_menu_item_id || row.canonical_menu_item_id))
      .map((row) => row.matched_menu_item_id || row.canonical_menu_item_id))];
    if (linkedIds.length === 1) {
      return {
        class: COMMERCE_IDENTITY_CLASS.EXACT_EXISTING_PRODUCT_ID_MATCH,
        displayName: driver.displayName,
        productId,
        soldQuantity: driver.soldQuantity,
        proposedMenuItemId: linkedIds[0],
        candidateMenuItemIds: linkedIds,
        reason: "Same Foodics product_id already carries a canonical menu id",
      };
    }
    if (linkedIds.length > 1) {
      return {
        class: COMMERCE_IDENTITY_CLASS.AMBIGUOUS,
        displayName: driver.displayName,
        productId,
        soldQuantity: driver.soldQuantity,
        proposedMenuItemId: null,
        candidateMenuItemIds: linkedIds,
        reason: "Same product_id maps to multiple menu ids",
      };
    }
  }

  const key = normalizeIdentityName(driver.displayName);
  const branchRows = (menuItems || []).filter((item) => (
    item.active !== false
    && (!branchId || item.branch_id === branchId || !item.branch_id)
    && normalizeIdentityName(item.name_en || item.name) === key
  ));
  const allActive = (menuItems || []).filter((item) => (
    item.active !== false && normalizeIdentityName(item.name_en || item.name) === key
  ));
  const uniqueIds = [...new Set(branchRows.map((item) => item.id))];
  if (uniqueIds.length === 1) {
    const placement = branchRows[0].placement_group_id;
    const clusterCopies = placement
      ? allActive.filter((item) => item.placement_group_id === placement && item.id !== uniqueIds[0])
      : [];
    if (clusterCopies.length) {
      return {
        class: COMMERCE_IDENTITY_CLASS.PLACEMENT_COPY_CLUSTER_MATCH,
        displayName: driver.displayName,
        productId,
        soldQuantity: driver.soldQuantity,
        proposedMenuItemId: uniqueIds[0],
        candidateMenuItemIds: [...uniqueIds, ...clusterCopies.map((item) => item.id)],
        reason: "Unique branch name with placement copies — mapping layer only, do not rewrite ingest",
      };
    }
    return {
      class: COMMERCE_IDENTITY_CLASS.EXACT_MENU_NAME_UNIQUE_BRANCH_MATCH,
      displayName: driver.displayName,
      productId,
      soldQuantity: driver.soldQuantity,
      proposedMenuItemId: uniqueIds[0],
      candidateMenuItemIds: uniqueIds,
      reason: "Exact normalized name, unique on this branch",
    };
  }
  if (uniqueIds.length > 1) {
    return {
      class: COMMERCE_IDENTITY_CLASS.AMBIGUOUS,
      displayName: driver.displayName,
      productId,
      soldQuantity: driver.soldQuantity,
      proposedMenuItemId: null,
      candidateMenuItemIds: uniqueIds,
      reason: "Multiple live menu rows share this name on the branch",
    };
  }
  return {
    class: COMMERCE_IDENTITY_CLASS.NO_MENU_MATCH,
    displayName: driver.displayName,
    productId,
    soldQuantity: driver.soldQuantity,
    proposedMenuItemId: null,
    candidateMenuItemIds: [],
    reason: "No exact menu name or product-id match",
  };
}

function latestReceipt(receiptLines = []) {
  return [...receiptLines].sort((left, right) => String(right.effective_at || right.created_at || "").localeCompare(String(left.effective_at || left.created_at || "")))[0] || null;
}

function hasUsableCanonicalCost(line) {
  const cost = line.unit_cost_canonical ?? line.canonical_unit_cost ?? line.unit_price;
  const qty = line.canonical_quantity ?? line.canonical_received_quantity;
  const unit = line.canonical_unit;
  return cost != null && cost !== "" && qty != null && unit;
}

export function classifyPurchaseEvidence({
  ingredient,
  costState = null,
  costHistory = [],
  catalogueItems = [],
  invoiceLines = [],
  receiptLines = [],
} = {}) {
  const name = ingredient?.canonical_name || ingredient?.canonicalName || ingredient?.name || "";
  if (ingredient?.active === false) {
    return { class: PURCHASE_EVIDENCE_CLASS.LEGACY_ONLY, recoverable: false, proposedCost: null, reason: "Inactive ingredient" };
  }
  if (isVerificationFixture(name) || /INV-OCR|\[temp verify/i.test(name)) {
    return { class: PURCHASE_EVIDENCE_CLASS.OCR_PLACEHOLDER, recoverable: false, proposedCost: null, reason: "Verification / OCR placeholder" };
  }

  const historyWithCost = (costHistory || []).filter((row) => (
    row.canonical_unit_cost != null || row.weighted_average_cost != null
  ));
  const completeReceipts = (receiptLines || []).filter(hasUsableCanonicalCost);
  const linkedCatalogue = (catalogueItems || []).filter((row) => (row.ingredientId || row.ingredient_id) === ingredient.id);

  if (completeReceipts.length || historyWithCost.length) {
    const latest = latestReceipt(completeReceipts);
    const history = historyWithCost[0];
    const value = latest?.unit_cost_canonical
      ?? latest?.canonical_unit_cost
      ?? history?.canonical_unit_cost
      ?? history?.weighted_average_cost;
    const unit = latest?.canonical_unit || history?.canonical_unit || ingredient.base_inventory_unit;
    const method = completeReceipts.length > 1 || history?.weighted_average_cost != null
      ? "weighted_average"
      : "last_purchase";
    const sourceTable = latest ? "inventory_purchase_receipt_lines" : "inventory_ingredient_cost_history";
    return {
      class: PURCHASE_EVIDENCE_CLASS.PURCHASE_EVIDENCE_COMPLETE,
      recoverable: true,
      proposedCost: {
        ingredientId: ingredient.id,
        value: String(value),
        unit,
        currency: "SAR",
        sourceTable,
        sourceId: latest?.id || latest?.receipt_id || history?.id || null,
        sourceDate: latest?.effective_at || history?.effective_at || history?.purchase_date || null,
        method,
        confidence: "source_backed",
        status: "PROPOSED",
      },
      reason: "Posted receipt or cost history already holds a unit cost",
    };
  }

  const mappedInvoices = (invoiceLines || []).filter((row) => row.ingredient_id === ingredient.id);
  if (mappedInvoices.length) {
    const priced = mappedInvoices.filter((row) => row.unit_price != null || row.line_total != null);
    if (priced.some((row) => !row.original_unit && !row.canonical_unit)) {
      return {
        class: PURCHASE_EVIDENCE_CLASS.PRICE_WITHOUT_UOM,
        recoverable: false,
        proposedCost: null,
        reason: "Invoice price has no unit",
      };
    }
    if (priced.some((row) => PACK_UNIT.test(String(row.original_unit || "")) && row.conversion_factor == null && !row.pack_size)) {
      return {
        class: PURCHASE_EVIDENCE_CLASS.PRICE_WITHOUT_USABLE_UNIT,
        recoverable: false,
        proposedCost: null,
        reason: "Pack purchase unit has no conversion",
      };
    }
    if (priced.some((row) => {
      const resolved = resolveRecipeLineUom({
        quantity: row.canonical_received_quantity || row.original_quantity || "1",
        unit: row.canonical_unit || row.original_unit,
        baseUom: ingredient.base_inventory_unit || ingredient.baseInventoryUnit,
        verifiedConversionFactor: row.conversion_factor,
      });
      return resolved.conversionStatus === CONVERSION_STATUS.INCOMPATIBLE;
    })) {
      return {
        class: PURCHASE_EVIDENCE_CLASS.UOM_CONVERSION_BLOCKED,
        recoverable: false,
        proposedCost: null,
        reason: "Purchase unit cannot convert to recipe unit",
      };
    }
    return {
      class: PURCHASE_EVIDENCE_CLASS.OCR_ONLY,
      recoverable: false,
      proposedCost: null,
      reason: "Invoice OCR line exists but was never posted to a receipt",
    };
  }

  const wac = costState?.weighted_average_cost ?? costState?.weightedAverageCost;
  const purchaseEvidence = Boolean(costState?.last_purchase_at || costState?.lastPurchaseAt || costState?.last_purchase_price != null);
  if (wac != null && Number(wac) === 0 && !purchaseEvidence && !linkedCatalogue.length) {
    return {
      class: PURCHASE_EVIDENCE_CLASS.NO_PURCHASE_SOURCE,
      recoverable: false,
      proposedCost: null,
      reason: "Default WAC 0 is not purchase evidence",
    };
  }

  if (linkedCatalogue.length) {
    return {
      class: PURCHASE_EVIDENCE_CLASS.SUPPLIER_ITEM_UNLINKED,
      recoverable: false,
      proposedCost: null,
      reason: "Catalogue item is linked but no posted purchase cost",
    };
  }

  return {
    class: PURCHASE_EVIDENCE_CLASS.NO_PURCHASE_SOURCE,
    recoverable: false,
    proposedCost: null,
    reason: "No invoice, receipt, catalogue, or history row",
  };
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows || []) counts[row[key]] = (counts[row[key]] || 0) + 1;
  return counts;
}

function coveredSoldQuantity(ledger) {
  const seen = new Map();
  for (const row of ledger.rows || []) {
    for (const item of row.menuItems || []) {
      const key = item.menuItemId || item.displayName;
      if (!seen.has(key)) seen.set(key, item.soldQuantity || "0");
    }
  }
  let total = "0";
  for (const qty of seen.values()) total = addDecimalString(total, qty);
  return total;
}

export function runInventoryReadinessAudit({
  recipes = [],
  versions = [],
  lines = [],
  ingredients = [],
  menuItems = [],
  salesRows = [],
  catalogueItems = [],
  costStateByIngredientId = {},
  costHistory = [],
  invoiceLines = [],
  receiptLines = [],
  branchId = null,
} = {}) {
  const graph = buildRecipeGraph({ recipes, versions, lines, ingredients });
  const versionsByRecipe = new Map();
  for (const version of versions || []) {
    if (!versionsByRecipe.has(version.recipe_id)) versionsByRecipe.set(version.recipe_id, []);
    versionsByRecipe.get(version.recipe_id).push(version);
  }

  const blockedRecipes = (recipes || [])
    .map((recipe) => classifyBlockedRecipe({
      recipe,
      versions: versionsByRecipe.get(recipe.id) || [],
      allRecipes: recipes,
      allVersions: versions,
      lines,
      ingredients,
      menuItems,
      salesRows,
    }))
    .filter((row) => row.class !== RECIPE_VERSION_CLASS.ANALYTICAL_OK);

  const recipeClassCounts = countBy(blockedRecipes, "class");
  const decisionCounts = countBy(blockedRecipes, "decision");
  const safeRecipes = blockedRecipes.filter((row) => row.decision === ACTIVATION_DECISION.SAFE_TO_ACTIVATE);

  const today = computeTheoreticalLedger({ salesRows, graph, identities: [] });
  let forcedGraph = graph;
  for (const row of safeRecipes) {
    const version = (versionsByRecipe.get(row.recipeId) || []).find((item) => item.id === row.candidate?.versionId);
    if (!version) continue;
    forcedGraph = graphWithForcedVersion(forcedGraph, row.recipeId, version, linesForVersion(lines, version.id));
  }
  const hypothetical = computeTheoreticalLedger({ salesRows, graph: forcedGraph, identities: [] });

  const drivers = aggregateSalesDrivers(salesRows);
  const nameOnly = drivers.filter((driver) => !driver.menuItemId).map((driver) => {
    const sample = (salesRows || []).find((row) => (
      !row.matched_menu_item_id
      && String(row.matched_menu_item_name || row.raw_item_name || "") === String(driver.displayName || "")
    ));
    return classifyCommerceIdentity({
      driver: { ...driver, foodicsProductId: sample?.foodics_product_id || sample?.product_id || null },
      salesRows,
      menuItems,
      branchId,
    });
  });

  const historyByIngredient = new Map();
  for (const row of costHistory || []) {
    const id = row.ingredient_id;
    if (!historyByIngredient.has(id)) historyByIngredient.set(id, []);
    historyByIngredient.get(id).push(row);
  }
  const invoicesByIngredient = new Map();
  const unmappedInvoiceLines = [];
  for (const row of invoiceLines || []) {
    if (!row.ingredient_id) {
      unmappedInvoiceLines.push(row);
      continue;
    }
    if (!invoicesByIngredient.has(row.ingredient_id)) invoicesByIngredient.set(row.ingredient_id, []);
    invoicesByIngredient.get(row.ingredient_id).push(row);
  }
  const receiptsByIngredient = new Map();
  for (const row of receiptLines || []) {
    if (!row.ingredient_id) continue;
    if (!receiptsByIngredient.has(row.ingredient_id)) receiptsByIngredient.set(row.ingredient_id, []);
    receiptsByIngredient.get(row.ingredient_id).push(row);
  }

  const activeIngredients = (ingredients || []).filter((row) => row.active !== false);
  const costs = activeIngredients.map((ingredient) => {
    const classified = classifyPurchaseEvidence({
      ingredient,
      costState: costStateByIngredientId[ingredient.id],
      costHistory: historyByIngredient.get(ingredient.id) || [],
      catalogueItems: (catalogueItems || []).filter((row) => (row.ingredientId || row.ingredient_id) === ingredient.id),
      invoiceLines: invoicesByIngredient.get(ingredient.id) || [],
      receiptLines: receiptsByIngredient.get(ingredient.id) || [],
    });
    const theoretical = (hypothetical.rows || []).find((row) => row.canonicalIngredientId === ingredient.id);
    return {
      ingredientId: ingredient.id,
      name: ingredient.canonical_name || ingredient.canonicalName,
      theoreticalQuantity: theoretical?.quantityTheoreticallyConsumed || "0",
      ...classified,
    };
  }).sort((left, right) => Number(right.theoreticalQuantity || 0) - Number(left.theoreticalQuantity || 0));

  const proposedActivationWrites = safeRecipes.map((row) => proposeActivateRecipeVersion({
    recipeId: row.recipeId,
    activateVersionId: row.candidate.versionId,
    versions: versionsByRecipe.get(row.recipeId) || [],
  }));
  const proposedIdentityRepairs = nameOnly
    .filter((row) => (
      row.class === COMMERCE_IDENTITY_CLASS.EXACT_EXISTING_PRODUCT_ID_MATCH
      || row.class === COMMERCE_IDENTITY_CLASS.EXACT_MENU_NAME_UNIQUE_BRANCH_MATCH
    ))
    .map((row) => ({
      itemName: row.displayName,
      productId: row.productId,
      proposedMenuItemId: row.proposedMenuItemId,
      method: row.class,
      layer: "canonical_mapping_not_ingest_mutation",
      executed: false,
    }));
  const proposedCostWrites = costs
    .filter((row) => row.recoverable && row.proposedCost)
    .map((row) => ({ ...row.proposedCost, executed: false }));

  const topSafe = [...safeRecipes]
    .sort((left, right) => Number(right.soldQuantity || 0) - Number(left.soldQuantity || 0))
    .slice(0, 20);

  return {
    recipes: {
      blocked: blockedRecipes.length,
      safeToActivate: decisionCounts[ACTIVATION_DECISION.SAFE_TO_ACTIVATE] || 0,
      reviewRequired: decisionCounts[ACTIVATION_DECISION.REVIEW_REQUIRED] || 0,
      doNotActivate: decisionCounts[ACTIVATION_DECISION.DO_NOT_ACTIVATE] || 0,
      broken: recipeClassCounts[RECIPE_VERSION_CLASS.BROKEN_RECIPE] || 0,
      mappingMissing: recipeClassCounts[RECIPE_VERSION_CLASS.MENU_MAPPING_MISSING] || 0,
      trueMissing: recipeClassCounts[RECIPE_VERSION_CLASS.TRUE_RECIPE_MISSING] || 0,
      multipleDrafts: recipeClassCounts[RECIPE_VERSION_CLASS.MULTIPLE_DRAFT_CANDIDATES] || 0,
      legacy: recipeClassCounts[RECIPE_VERSION_CLASS.LEGACY_STALE_ONLY] || 0,
      nonKitchen: recipeClassCounts[RECIPE_VERSION_CLASS.NON_KITCHEN_FALSE_POSITIVE] || 0,
      classCounts: recipeClassCounts,
      rows: blockedRecipes,
      topSafe,
    },
    sales: {
      soldDrivers: drivers.length,
      coveredToday: today.coverage.recipeCoveredSoldRows,
      uncoveredToday: today.coverage.recipeUncoveredSoldRows,
      coveredIfSafeActivated: hypothetical.coverage.recipeCoveredSoldRows,
      coveredSoldQuantityIfSafe: coveredSoldQuantity(hypothetical),
      nameOnly: nameOnly.length,
      identityClassCounts: countBy(nameOnly, "class"),
      identityRows: nameOnly,
    },
    costs: {
      activeIngredients: activeIngredients.length,
      classCounts: countBy(costs, "class"),
      withAnyEvidence: costs.filter((row) => (
        row.class !== PURCHASE_EVIDENCE_CLASS.NO_PURCHASE_SOURCE
        && row.class !== PURCHASE_EVIDENCE_CLASS.OCR_PLACEHOLDER
        && row.class !== PURCHASE_EVIDENCE_CLASS.LEGACY_ONLY
      )).length,
      recoverable: proposedCostWrites.length,
      unmappedInvoiceLines: unmappedInvoiceLines.length,
      rows: costs,
    },
    proposedActivationWrites,
    proposedIdentityRepairs,
    proposedCostWrites,
    lifecycle: {
      currentWritePath: "createRecipe / saveRecipeDraft always persist status=draft and never promote",
      intendedTransition: "edit → structural validate → review → activate (retire previous active) → next edit opens a new draft",
      gap: "No activate RPC or Food Bible publish control. Completing a card does not flip version status.",
    },
  };
}
