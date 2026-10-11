import { addDecimal, divideDecimal, multiplyDecimal } from "../inventoryIntelligence";

const BRANCHES = ["khobar", "riyadh", "jeddah"];

export function parseConsumptionQuestion(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(wastage|waste|breakage|broken glass|spillage)\b/.test(q)) return null;
  const asks = /\b(consum|should (we |i )?have used|theoretical|recipe coverage|incomplete recipes|unresolved conversions)\b/.test(q)
    || /\bhow much\b/.test(q);
  if (!asks) return null;
  const branch = BRANCHES.find((id) => new RegExp(`\\b${id}\\b`).test(q)) || null;
  const named = q.match(/\bhow much\s+([a-z0-9][a-z0-9 '&-]{1,40}?)\s+(should|did|would|have|khobar|riyadh|jeddah|yesterday|last|this|today|in)\b/);
  const ingredient = named ? named[1].replace(/\s+(should|have)$/, "").trim() : null;
  let period = null;
  if (/\byesterday\b/.test(q)) period = "yesterday";
  else if (/\blast week\b|\bpast week\b/.test(q)) period = "last_week";
  else if (/\btoday\b/.test(q)) period = "today";
  const topic = /\bincomplete recipes\b/.test(q)
    ? "incomplete_recipes"
    : (/\bcoverage\b/.test(q) ? "coverage" : "ingredient");
  return { ingredient, branch, period, topic };
}

export function consumptionWindow(period, today) {
  const end = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  const iso = (date) => date.toISOString().slice(0, 10);
  if (period === "yesterday") {
    end.setUTCDate(end.getUTCDate() - 1);
    const day = iso(end);
    return { start: day, end: day, label: day };
  }
  if (period === "today") {
    const day = iso(end);
    return { start: day, end: day, label: day };
  }
  if (period === "last_week") {
    const finish = new Date(end);
    finish.setUTCDate(finish.getUTCDate() - 1);
    const start = new Date(finish);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: iso(start), end: iso(finish), label: `${iso(start)} to ${iso(finish)}` };
  }
  return null;
}

export function saleCountsAsSold(row) {
  const quantity = Number(row.quantity_sold);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (row.is_modifier) return false;
  if (["modifier", "operational"].includes(row.semantic_class)) return false;
  return true;
}

export function scaleStoredRecipeQuantity(soldQuantity, outputQuantity, canonicalQuantity) {
  return multiplyDecimal(String(soldQuantity), divideDecimal(String(canonicalQuantity), String(outputQuantity || "1")));
}

export function summarizeIngredientConsumption({
  ingredient = null,
  ingredients = [],
  branchId = null,
  window = null,
  sales = [],
  recipeLinks = [],
  latestSalesDate = null,
  source = null,
  salesComplete = true,
  accessDenied = false,
} = {}) {
  if (salesComplete === false) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId,
      periodLabel: window?.label || null,
      ingredient: ingredient?.name || null,
      reason: "The sales read stopped before the period was finished. No total is shown.",
    };
  }
  if (accessDenied) {
    return { status: "UNAVAILABLE", postsStock: false, quantity: null, reason: "This account cannot read that branch." };
  }
  if (!branchId || !window) {
    return { status: "UNAVAILABLE", postsStock: false, quantity: null, reason: "Name the branch and the day or week." };
  }
  if (ingredients.length > 1) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      reason: `More than one ingredient matches. Choose one: ${ingredients.map((item) => item.name).join(", ")}.`,
    };
  }
  if (!ingredient) {
    return { status: "UNAVAILABLE", postsStock: false, quantity: null, reason: "No single ingredient was named." };
  }
  const eligible = sales.filter(saleCountsAsSold);
  const linkedIds = new Set(recipeLinks.map((link) => link.menuItemId).filter(Boolean));
  const productIds = new Set(recipeLinks.map((link) => link.productId).filter(Boolean));
  const covered = eligible.filter((row) => (
    linkedIds.has(row.matched_menu_item_id) || productIds.has(row.foodics_product_id)
  ));
  if (!eligible.length) {
    const through = latestSalesDate
      ? ` Canonical Foodics sales for this branch are published through ${latestSalesDate}.`
      : "";
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId,
      periodLabel: window.label,
      ingredient: ingredient.name,
      source: source || null,
      coverage: { eligibleSoldRows: 0, recipeLinkedRows: 0 },
      reason: `No completed sales rows fall in ${window.label}.${through}`,
    };
  }
  if (!covered.length) {
    return {
      status: "UNAVAILABLE",
      postsStock: false,
      quantity: null,
      branchId,
      periodLabel: window.label,
      ingredient: ingredient.name,
      coverage: { eligibleSoldRows: eligible.length, recipeLinkedRows: 0 },
      reason: `${eligible.length} sold rows are in this period, and none are linked by menu id to an active recipe that uses ${ingredient.name}.`,
    };
  }
  let quantity = "0";
  const products = {};
  covered.forEach((row) => {
    const link = recipeLinks.find((item) => (
      (item.menuItemId && item.menuItemId === row.matched_menu_item_id)
      || (item.productId && item.productId === row.foodics_product_id)
    ));
    if (!link) return;
    const part = scaleStoredRecipeQuantity(row.quantity_sold, link.outputQuantity, link.canonicalQuantity);
    quantity = addDecimal(quantity, part);
    const name = row.raw_item_name || "Unnamed product";
    products[name] = addDecimal(products[name] || "0", part);
  });
  return {
    status: "PROVISIONAL",
    postsStock: false,
    quantity,
    unit: recipeLinks[0]?.canonicalUnit || null,
    branchId,
    periodLabel: window.label,
    ingredient: ingredient.name,
    source: "FOOD_BIBLE_MENU_LINK",
    verification: "The menu id link is stored. The recipe is not marked verified against a Foodics recipe export.",
    cost: null,
    coverage: {
      eligibleSoldRows: eligible.length,
      recipeLinkedRows: covered.length,
    },
    products: Object.entries(products).slice(0, 8).map(([name, amount]) => ({ name, amount })),
    reason: "Stored canonical quantity was scaled by units sold. Yield was not applied a second time.",
  };
}

export function formatConsumptionAnswer(result, todayLabel) {
  if (!result) return "No consumption calculation was run. No stock was posted.";
  const scope = [result.branchId, result.periodLabel || todayLabel].filter(Boolean).join(", ");
  if (result.status !== "PROVISIONAL" || result.quantity == null) {
    return `${scope ? `${scope}. ` : ""}${result.reason} No stock was posted.`;
  }
  return [
    `${result.ingredient}: ${result.quantity} ${result.unit || ""}`.trim() + `.`,
    scope ? `${scope}.` : null,
    `Coverage ${result.coverage.recipeLinkedRows} of ${result.coverage.eligibleSoldRows} sold rows link to this ingredient.`,
    result.verification,
    "Theoretical only. No stock was posted.",
  ].filter(Boolean).join(" ");
}
