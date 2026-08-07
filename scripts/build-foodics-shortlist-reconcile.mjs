#!/usr/bin/env node
/**
 * Preview-only Foodics legacy reconciliation for Food Bible shortlist.
 * Does not mutate production. Foodics is external evidence only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "food-bible-sources");

async function loadModule() {
  const jiti = (await import("jiti")).default;
  const load = jiti(path.join(root, "scripts"), { esmResolve: true, interopDefault: true });
  return load(path.join(root, "src/inventory/foodicsLegacyReconcile.js"));
}

async function main() {
  const {
    parseFoodicsProductIngredientCsv,
    parseFoodicsModifierCsv,
    reconcileShortlistWithFoodics,
  } = await loadModule();

  const cohortPath = path.join(outDir, "cohort_preview.json");
  const foodicsPath = path.join(outDir, "foodics_legacy_shortlist_evidence.csv");
  const modifiersPath = path.join(outDir, "foodics_legacy_shortlist_modifiers.csv");

  if (!fs.existsSync(cohortPath)) {
    console.error("Missing cohort_preview.json — run Food Bible cohort preview first.");
    process.exit(1);
  }
  if (!fs.existsSync(foodicsPath)) {
    console.error("Missing foodics_legacy_shortlist_evidence.csv");
    process.exit(1);
  }

  const cohort = JSON.parse(fs.readFileSync(cohortPath, "utf8"));
  const foodicsRows = parseFoodicsProductIngredientCsv(fs.readFileSync(foodicsPath, "utf8"));
  const modifierRows = fs.existsSync(modifiersPath)
    ? parseFoodicsModifierCsv(fs.readFileSync(modifiersPath, "utf8"))
    : [];

  const report = reconcileShortlistWithFoodics({
    recipes: cohort.recipes || [],
    foodicsRows,
    modifierRows,
    dependencies: cohort.dependencies || [],
  });

  const jsonPath = path.join(outDir, "FOODICS_SHORTLIST_RECONCILE.json");
  const mdPath = path.join(outDir, "FOODICS_SHORTLIST_RECONCILE.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(JSON.stringify({ jsonPath, mdPath, summary: report.summary }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function renderMarkdown(r) {
  const lines = [];
  lines.push("# Foodics shortlist reconciliation (preview only)");
  lines.push("");
  lines.push("Foodics = EXTERNAL LEGACY EVIDENCE. Food Bible remains recipe authority. Foodics costs are LEGACY_FOODICS_REFERENCE only.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [k, v] of Object.entries(r.summary || {})) {
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push("");
  lines.push(`- Production mutation: \`${r.productionMutation}\``);
  lines.push(`- Sales approval: \`${r.salesApproval}\``);
  lines.push(`- Real Khobar purchase/cost still required: \`${r.realKhobarPurchaseCostStillRequired}\``);
  lines.push("");

  for (const g of r.groups || []) {
    lines.push(`## ${g.shortlistKey}`);
    lines.push("");
    lines.push(`- Food Bible: ${g.foodBibleTitle}`);
    lines.push(`- Foodics product SKUs: ${(g.foodicsProductSkus || []).join(", ")}`);
    lines.push(`- Foodics primary rows: ${g.foodicsPrimaryRowCount}`);
    lines.push(`- Quantity conflicts: ${g.quantityConflicts.length}`);
    lines.push("");
    lines.push("| Food Bible | KSA op | Type | Foodics | Prod SKU | Inv SKU | Qty | Unit | Cost | Action | Conflict | Conf |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const row of g.reconciliations) {
      lines.push(
        `| ${esc(row.foodBibleSourceName)} | ${esc(row.ksaOperationalName)} | ${esc(row.recordType)} | ${esc(row.foodicsSourceName)} | ${esc(row.foodicsProductSku)} | ${esc(row.foodicsInventorySku)} | ${esc(row.foodicsQty)} | ${esc(row.foodicsUnit)} | ${esc(row.foodicsIngredientCost)} | ${esc(row.action)} | ${esc(row.sourceConflict?.code || "")} | ${esc(row.confidence)} |`
      );
    }
    lines.push("");
    if (g.modifiers?.length) {
      lines.push("### Modifiers (evidence only)");
      lines.push("");
      for (const m of g.modifiers) {
        lines.push(`- ${m.modifierName} → stock class \`${m.stockEffectClass}\` (min ${m.minimumOptions}, max ${m.maximumOptions})`);
      }
      lines.push("");
    }
  }

  lines.push("## Remaining human confirmations");
  lines.push("");
  for (const c of r.remainingHumanConfirmations || []) lines.push(`- ${c}`);
  lines.push("");
  lines.push("## READY_FOR_APPROVAL");
  lines.push("");
  lines.push(r.readyForApproval?.length ? r.readyForApproval.join(", ") : "none");
  lines.push("");
  lines.push("Netlify: NOT DEPLOYED");
  lines.push("");
  return lines.join("\n");
}

function esc(v) {
  if (v == null) return "";
  return String(v).replace(/\|/g, "/").replace(/\n/g, " ");
}
