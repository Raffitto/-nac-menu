#!/usr/bin/env node
/**
 * Rebuild Khobar Food Bible cohort preview from extracted page JSON.
 * Preview only — never mutates production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Jest/CRA compile ESM via babel; for Node preview script use dynamic import of source via experimental.
// Prefer compiled path through babel-node-less approach: register via jiti if available, else transpile-lite.
async function loadExtractModule() {
  try {
    const jiti = (await import("jiti")).default;
    const load = jiti(path.join(root, "scripts"), { esmResolve: true, interopDefault: true });
    return load(path.join(root, "src/inventory/foodBiblePdfExtract.js"));
  } catch {
    // Fallback: use Node with --experimental-vm-modules after converting via esbuild-register if present.
    const modPath = pathToFileURL(path.join(root, "src/inventory/foodBiblePdfExtract.js")).href;
    return import(modPath);
  }
}

function listRawJson(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort();
}

function writeReport(preview, outMd) {
  const s = preview.summary;
  const lines = [];
  lines.push("# Khobar Food Bible Cohort Preview (KSA)");
  lines.push("");
  lines.push("Status: **PREVIEW ONLY — production apply blocked**");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [k, v] of Object.entries(s)) {
    lines.push(`- **${k}**: ${v}`);
  }
  lines.push("");
  lines.push("## KSA adaptations");
  lines.push("");
  for (const a of preview.adaptations) {
    lines.push(
      `- \`${a.sourceFile}\` / \`${a.sourceTitle}\` → \`${a.ksaOperationalTitle || ""}\`: ${a.type || a.code} ${a.rule || ""} ${a.sourceIngredient || a.sourceTitle || ""} ${a.ksaIngredient || a.ksaOperationalTitle || ""}`.trim()
    );
  }
  if (!preview.adaptations.length) lines.push("- None");
  lines.push("");
  lines.push("## Menu product linkages (finished)");
  lines.push("");
  for (const link of preview.menuLinks) {
    const names = link.menuMatches.map((m) => m.name).join(" | ") || "(none)";
    lines.push(
      `- **${link.linkStatus}** \`${link.ksaOperationalTitle}\` ← ${names}`
    );
  }
  lines.push("");
  lines.push("## Finished recipes");
  lines.push("");
  for (const r of preview.recipes.filter((x) => x.recipeKind === "finished")) {
    lines.push(
      `- \`${r.ksaOperationalTitle}\` (source: \`${r.sourceTitle}\`) yield=${r.yieldRaw} ings=${(r.ksaIngredients || []).length} trust=${r.previewTrustStatus} locator=${r.sourceLocator}`
    );
  }
  lines.push("");
  lines.push("## Prep / subrecipes");
  lines.push("");
  for (const r of preview.recipes.filter((x) => x.recipeKind === "prep")) {
    lines.push(
      `- \`${r.ksaOperationalTitle}\` yield=${r.yieldRaw} ings=${(r.ksaIngredients || []).length} trust=${r.previewTrustStatus}`
    );
  }
  lines.push("");
  lines.push("## Source inconsistencies (sample)");
  lines.push("");
  let n = 0;
  for (const r of preview.recipes) {
    for (const issue of r.issues || []) {
      if (issue.code !== "SOURCE_RECIPE_INCONSISTENCY") continue;
      lines.push(`- ${r.sourceFile} / ${r.sourceTitle}: ${issue.detail}`);
      n += 1;
      if (n >= 40) break;
    }
    if (n >= 40) break;
  }
  lines.push("");
  lines.push("## Dependency hints (finished -> prep)");
  lines.push("");
  for (const d of preview.dependencies.slice(0, 60)) {
    lines.push(`- ${d.finished} -> ${d.ingredient} => prep \`${d.prep}\``);
  }
  lines.push("");
  lines.push("## Gates");
  lines.push("");
  lines.push("- Production mutation: **NO**");
  lines.push("- Sales approval: **NOT IN SCOPE**");
  lines.push("- Netlify deploy: **NOT DEPLOYED**");
  lines.push("");
  fs.writeFileSync(outMd, lines.join("\n"), "encoding", "utf8");
}

async function main() {
  const { buildFoodBibleCohortPreview } = await loadExtractModule();
  const rawDir = path.join(root, "tmp/food-bible-sources/raw");
  const menuPath = path.join(root, "tmp/food-bible-sources/menu_link_preview.json");
  const outJson = path.join(root, "tmp/food-bible-sources/cohort_preview.json");
  const outMd = path.join(root, "tmp/food-bible-sources/COHORT_PREVIEW_REPORT.md");

  const files = listRawJson(rawDir).map((p) => {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      sourceFile: data.fileName,
      sourcePath: data.sourcePath,
      sha256: data.sha256,
      pages: data.pages,
    };
  });

  let menuItems = [];
  if (fs.existsSync(menuPath)) {
    const menuPreview = JSON.parse(fs.readFileSync(menuPath, "utf8"));
    // Flatten unique menu names from prior browser pull if present; optional second arg file.
  }
  const menuItemsPath = path.join(root, "tmp/food-bible-sources/khobar_menu_items.json");
  if (fs.existsSync(menuItemsPath)) {
    menuItems = JSON.parse(fs.readFileSync(menuItemsPath, "utf8"));
  }

  const preview = buildFoodBibleCohortPreview({ files, menuItems });
  fs.writeFileSync(outJson, JSON.stringify(preview, null, 2));
  // write markdown
  const s = preview.summary;
  const lines = [];
  lines.push("# Khobar Food Bible Cohort Preview (KSA)");
  lines.push("");
  lines.push("Status: **PREVIEW ONLY — production apply blocked**");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [k, v] of Object.entries(s)) lines.push(`- **${k}**: ${v}`);
  lines.push("");
  lines.push("## KSA adaptations");
  lines.push("");
  if (!preview.adaptations.length) lines.push("- None");
  for (const a of preview.adaptations) {
    lines.push(
      `### ${a.sourceFile} / ${a.sourceTitle}\n- KSA operational title: \`${a.ksaOperationalTitle || ""}\`\n- ${a.code}: ${JSON.stringify(a)}`
    );
  }
  lines.push("");
  lines.push("## Menu product linkages (finished)");
  lines.push("");
  for (const link of preview.menuLinks) {
    const names = link.menuMatches.map((m) => m.name).join(" | ") || "(none)";
    lines.push(`- **${link.linkStatus}** \`${link.ksaOperationalTitle}\` ← ${names}`);
  }
  lines.push("");
  lines.push("## Finished recipes");
  lines.push("");
  for (const r of preview.recipes.filter((x) => x.recipeKind === "finished")) {
    lines.push(
      `- \`${r.ksaOperationalTitle}\` (source: \`${r.sourceTitle}\`) yield=${r.yieldRaw} ings=${(r.ksaIngredients || []).length} trust=${r.previewTrustStatus} locator=${r.sourceLocator}`
    );
  }
  lines.push("");
  lines.push("## Prep / subrecipes");
  lines.push("");
  for (const r of preview.recipes.filter((x) => x.recipeKind === "prep")) {
    lines.push(
      `- \`${r.ksaOperationalTitle}\` yield=${r.yieldRaw} ings=${(r.ksaIngredients || []).length} trust=${r.previewTrustStatus}`
    );
  }
  lines.push("");
  lines.push("## Source inconsistencies (sample)");
  lines.push("");
  let n = 0;
  for (const r of preview.recipes) {
    for (const issue of r.issues || []) {
      if (issue.code !== "SOURCE_RECIPE_INCONSISTENCY") continue;
      lines.push(`- ${r.sourceFile} / ${r.sourceTitle}: ${issue.detail}`);
      n += 1;
      if (n >= 50) break;
    }
    if (n >= 50) break;
  }
  lines.push("");
  lines.push("## Gates");
  lines.push("");
  lines.push("- Production mutation: **NO**");
  lines.push("- Sales approval: **NOT IN SCOPE**");
  lines.push("- Netlify deploy: **NOT DEPLOYED**");
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
