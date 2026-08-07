#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function loadModule() {
  const jiti = (await import("jiti")).default;
  const load = jiti(path.join(root, "scripts"), { esmResolve: true, interopDefault: true });
  return load(path.join(root, "src/inventory/shortlistIngredientCostPreview.js"));
}

function mainEvidence() {
  return {
    canonicalIngredients: [], // production has 0 active culinary canonicals
    invoiceLines: [], // only verification cream exists; excluded
    aliases: [],
    catalogueItems: [],
    costHistory: [],
    purchaseLines: [],
    baselines: [],
  };
}

async function main() {
  const { buildShortlistIngredientCostPreview } = await loadModule();
  const cohort = JSON.parse(
    fs.readFileSync(path.join(root, "tmp/food-bible-sources/cohort_preview.json"), "utf8")
  );
  const menu = JSON.parse(
    fs.readFileSync(path.join(root, "tmp/food-bible-sources/shortlist_menu_placements.json"), "utf8")
  );
  const sectionRows = [
    { id: "c85af381-3d5d-41ba-be33-91fe3cd61315", name_en: "Mains", daypart: "Daytime" },
    { id: "5f17a52a-335d-4455-a849-947746d20e68", name_en: "Add Ons", daypart: "Daytime" },
    { id: "294662da-4fe3-47f3-8a65-de54f312719e", name_en: "Nibbles", daypart: "Daytime" },
    { id: "10be5f92-33d2-4549-8b3f-ecef67e6573e", name_en: "Add Ons", daypart: "Evening Menu" },
    { id: "286672d0-325b-4ce9-86d1-9e1d4954f253", name_en: "Add Ons", daypart: "Brunch" },
    { id: "8e0eb02b-3a91-4881-ba89-fc3c21ea277c", name_en: "Plates", daypart: "Brunch" },
    { id: "8e8c0878-d1d8-466e-a9b5-58a8db0d3aa5", name_en: "Nibbles", daypart: "Brunch" },
    { id: "941563a7-5b3f-41dc-a63e-310e05b96faa", name_en: "Sides", daypart: "Breakfast" },
    { id: "c15ffd9b-c6ce-4620-98ed-5e4dd041d6b0", name_en: "Nibbles", daypart: "Evening Menu" },
    { id: "eb3d3d77-5e23-44f5-8c90-582c389e7602", name_en: "Mains", daypart: "Evening Menu" },
  ];
  const sectionMap = Object.fromEntries(sectionRows.map((s) => [s.id, s]));
  const focusMenu = menu.filter((m) =>
    /^(Rigatoni Pink Sauce|Cajun Chicken|Halloumi|Grilled Halloumi|Halloumi Fries|Truffle Burger)$/i.test(
      m.name || m.name_en || ""
    )
  );

  const preview = buildShortlistIngredientCostPreview({
    recipes: cohort.recipes || [],
    ...mainEvidence(),
    menuItems: focusMenu,
    sectionMap,
  });

  const outJson = path.join(root, "tmp/food-bible-sources/SHORTLIST_INGREDIENT_COST_PREVIEW.json");
  const outMd = path.join(root, "tmp/food-bible-sources/SHORTLIST_INGREDIENT_COST_PREVIEW.md");
  fs.writeFileSync(outJson, JSON.stringify(preview, null, 2));

  const lines = [];
  lines.push("# Shortlist Canonical Ingredient + July Cost Preview");
  lines.push("");
  lines.push("Status: **PREVIEW ONLY — no production mutation**");
  lines.push("");
  lines.push("## Evidence audit (Khobar production)");
  lines.push("");
  lines.push("- Active culinary canonical ingredients: **0**");
  lines.push("- July culinary invoice/OCR lines: **0** (only verification cream present; excluded)");
  lines.push("- Approved cost baselines: **0**");
  lines.push("- Company Knowledge culinary/cost/purchase files: **0** (vault has ops logbooks + reception only)");
  lines.push("- International recipe costs: **not used**");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [k, v] of Object.entries(preview.summary)) lines.push(`- **${k}**: ${v}`);
  lines.push("");
  lines.push("## A. Ingredients READY");
  lines.push("");
  lines.push("- None");
  lines.push("");
  lines.push("## B. Ingredients NEEDING REVIEW");
  lines.push("");
  for (const item of preview.ingredients) {
    lines.push(
      `- \`${item.sourceIngredient}\` → \`${item.proposedCanonicalName}\` | base=${item.proposedBaseUnit} | units=${item.sourceUnits.join(",")} | recipes=${item.sourceRecipes.join("; ")} | ${item.previewClassification.status}: ${item.previewClassification.reason}`
    );
  }
  lines.push("");
  lines.push("## C. Costs READY");
  lines.push("");
  lines.push("- None");
  lines.push("");
  lines.push("## D. Costs MISSING/CONFLICTING");
  lines.push("");
  lines.push(`- NO_JULY_COST: **${preview.summary.noJulyCost}** / ${preview.summary.uniqueIngredientCount}`);
  lines.push(`- CONFLICTING_COST: **${preview.summary.conflictingCosts}**`);
  lines.push("");
  lines.push("## E. Menu placements READY (proposal only)");
  lines.push("");
  for (const group of preview.menuPlacementReview) {
    lines.push(`### ${group.key}`);
    lines.push(`- classification: **${group.classification}**`);
    lines.push(`- proposal: ${group.proposal || "n/a"}`);
    lines.push(`- dayparts: ${(group.evidence.dayparts || []).join(", ") || "unknown"}`);
    for (const item of group.items) {
      lines.push(
        `  - ${item.id} | ${item.name} | ${item.price} | ${item.daypart}/${item.sectionName} | pg=${item.placementGroupId || "null"}`
      );
    }
  }
  lines.push("");
  lines.push("## F. Yield/source blockers");
  lines.push("");
  for (const b of preview.yieldBlockers) {
    lines.push(`- **${b.recipe}**: ${b.classification} — ${b.issue}. ${b.detail}`);
  }
  lines.push("");
  lines.push("## Possible duplicate canonicals");
  lines.push("");
  for (const d of preview.possibleDuplicateCanonicals) {
    lines.push(`- ${d.code} \`${d.group}\`: ${d.items.join(" | ")} — ${d.note}`);
  }
  if (!preview.possibleDuplicateCanonicals.length) lines.push("- None");
  lines.push("");
  lines.push("## Closest to READY_FOR_APPROVAL");
  lines.push("");
  lines.push("- No recipe can become READY_FOR_APPROVAL until July Khobar culinary costs and canonical items exist.");
  lines.push("- After human confirmation only (still blocked on cost data): menu multi-placement proposal for Rigatoni / Cajun / Truffle Burger / Halloumi.");
  lines.push("");
  lines.push("## Human confirmations needed");
  lines.push("");
  lines.push("1. Upload/approve July Khobar ingredient purchase or item-cost evidence");
  lines.push("2. Confirm canonical names / possible duplicates (olive oil grades, butter, parmigiano spelling)");
  lines.push("3. Confirm one-recipe→multi-placement for same-name dayparts");
  lines.push("4. Confirm Halloumi vs Grilled Halloumi (same or distinct); exclude Halloumi Fries");
  lines.push("5. Yield blockers: Cajun Sauce, Sweet Corn 1110g, Halloumi, Truffle prep unpaired rows");
  lines.push("6. Keep Mirin/Miso out of apply");
  lines.push("");
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`);
  console.log(JSON.stringify(preview.summary, null, 2));
  console.log(`Wrote ${outJson}`);
  console.log(`Wrote ${outMd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
