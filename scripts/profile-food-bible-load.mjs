#!/usr/bin/env node
/**
 * Authenticated timing of the Food Bible load path against production-shaped data.
 * Does not change data. Uses staff magic-link like other Food Bible verifiers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const STAFF_EMAIL = process.env.SUPABASE_STAFF_EMAIL || "raffiazarian2@gmail.com";
const BRANCH = process.env.FOOD_BIBLE_BRANCH || "khobar";
const MODE = process.env.FOOD_BIBLE_PROFILE_MODE || "before";

function loadEnvLocal() {
  const env = {};
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

function getServiceRole(projectRef) {
  const out = execSync(`supabase projects api-keys --project-ref ${projectRef} -o json`, {
    encoding: "utf8",
    cwd: root,
  });
  const keys = JSON.parse(out);
  const service = keys.find((key) => key.name === "service_role" || key.id === "service_role");
  if (!service?.api_key) throw new Error("service_role key not found");
  return service.api_key;
}

async function signInStaff(url, anonKey, serviceRole) {
  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: STAFF_EMAIL });
  if (error) throw error;
  const { error: otpError } = await userClient.auth.verifyOtp({
    token_hash: data?.properties?.hashed_token,
    type: "magiclink",
  });
  if (otpError) throw otpError;
  return userClient;
}

async function timed(label, fn) {
  const started = performance.now();
  const result = await fn();
  return { label, ms: Math.round(performance.now() - started), result };
}

async function profileBefore(client) {
  const requests = [];
  const auth = await timed("auth.getUser", () => client.auth.getUser());
  requests.push(auth);

  const wave1 = await timed("wave1.serial_after_auth.menu_recipes_ingredients", async () => {
    const menu = await timed("menu_catalogue.select_*", async () => {
      const [categories, sections, items] = await Promise.all([
        timed("categories.*", async () => client.from("categories").select("*").eq("branch_id", BRANCH)),
        timed("sections.*", async () => client.from("sections").select("*").eq("branch_id", BRANCH)),
        timed("menu_items.*", async () => client.from("menu_items").select("*").eq("branch_id", BRANCH)),
      ]);
      return { categories, sections, items };
    });
    const recipes = await timed("inventory_recipes.*", () => client.from("inventory_recipes").select("*"));
    const ingredients = await timed("inventory_ingredients.*", () => client.from("inventory_ingredients").select("*"));
    return { menu, recipes, ingredients };
  });
  requests.push(wave1);

  const recipeRows = wave1.result.recipes.result.data || [];
  const recipeIds = recipeRows.map((row) => row.id);
  const versions = await timed("inventory_recipe_versions.* (after recipes)", () =>
    client.from("inventory_recipe_versions").select("*").in("recipe_id", recipeIds),
  );
  requests.push(versions);
  const versionIds = (versions.result.data || []).map((row) => row.id);
  const lines = await timed("inventory_recipe_version_lines.* (after versions)", () =>
    client.from("inventory_recipe_version_lines").select("*").in("recipe_version_id", versionIds),
  );
  requests.push(lines);

  const staff = await timed("ask_nac_staff", () =>
    client.from("ask_nac_staff").select("vault_role, primary_branch_id").ilike("email", STAFF_EMAIL).maybeSingle(),
  );
  const branches = await timed("ask_nac_user_branch_access", () =>
    client.from("ask_nac_user_branch_access").select("branch_id").ilike("email", STAFF_EMAIL),
  );

  const itemBytes = JSON.stringify(wave1.result.menu.result.items.result.data || []).length;
  const recipeBytes = JSON.stringify(recipeRows).length;
  const versionBytes = JSON.stringify(versions.result.data || []).length;
  const lineBytes = JSON.stringify(lines.result.data || []).length;
  const ingredientBytes = JSON.stringify(wave1.result.ingredients.result.data || []).length;

  return {
    mode: "before",
    branch: BRANCH,
    counts: {
      categories: (wave1.result.menu.result.categories.result.data || []).length,
      sections: (wave1.result.menu.result.sections.result.data || []).length,
      menuItems: (wave1.result.menu.result.items.result.data || []).length,
      recipes: recipeRows.length,
      versions: (versions.result.data || []).length,
      lines: (lines.result.data || []).length,
      ingredients: (wave1.result.ingredients.result.data || []).length,
    },
    payloadBytes: { itemBytes, recipeBytes, versionBytes, lineBytes, ingredientBytes },
    timingsMs: {
      authGetUser: auth.ms,
      categories: wave1.result.menu.result.categories.ms,
      sections: wave1.result.menu.result.sections.ms,
      menuItemsStar: wave1.result.menu.result.items.ms,
      recipesStar: wave1.result.recipes.ms,
      ingredientsStar: wave1.result.ingredients.ms,
      versionsAfterRecipes: versions.ms,
      linesAfterVersions: lines.ms,
      staff: staff.ms,
      branchAccess: branches.ms,
      waterfallCore: wave1.ms + versions.ms + lines.ms,
    },
    requestCount: 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1,
    notes: [
      "Current UI waits for menu+recipes+ingredients, then all versions, then all lines.",
      "menu_items.select(*) includes image and unused guest fields.",
      "Staff access is an extra sequential pair after/in parallel with overview.",
    ],
  };
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function operationalMetrics(menuItems, sections, categories, recipes) {
  const sectionById = Object.fromEntries((sections || []).map((row) => [row.id, row]));
  const categoryById = Object.fromEntries((categories || []).map((row) => [row.id, row]));
  const groups = new Map();
  for (const item of menuItems || []) {
    if (/\[temp verify/i.test(item.name_en || "")) continue;
    const key = item.placement_group_id ? `pg:${item.placement_group_id}` : `name:${normalizeName(item.name_en)}`;
    const existing = groups.get(key);
    if (!existing) groups.set(key, { key, item, placements: [item] });
    else existing.placements.push(item);
  }
  const drinkRe = /drink|beverage|coffee|espresso|soft\s*drink|barista|add-?ons?|extras/i;
  const drinkNameRe = /pepsi|cola|coke|sprite|water|espresso|latte|cappuccino|americano|coffee/i;
  let kitchen = 0;
  let drinks = 0;
  let mapped = 0;
  let missing = 0;
  const activeRecipes = (recipes || []).filter((row) => row.active !== false);
  for (const group of groups.values()) {
    const section = sectionById[group.item.section_id];
    const category = categoryById[section?.category_id]?.name_en || "";
    const live = group.item.active !== false && !group.item.sold_out;
    const isDrink = drinkRe.test(category) || (drinkNameRe.test(group.item.name_en || "") && !/melon/i.test(group.item.name_en || ""));
    if (isDrink) drinks += 1;
    if (!live || isDrink) continue;
    kitchen += 1;
    const identityName = normalizeName(group.item.name_en);
    const recipe = activeRecipes.find((row) => (
      group.placements.some((item) => item.id === row.menu_item_id)
      || normalizeName(row.name) === identityName
      || normalizeName(row.name_en) === identityName
    ));
    if (recipe) mapped += 1;
    else missing += 1;
  }
  return {
    uniqueIdentities: groups.size,
    placementCount: (menuItems || []).length,
    liveKitchenItems: kitchen,
    drinks,
    mapped,
    missing,
    coveragePct: kitchen ? Math.round((mapped / kitchen) * 100) : 0,
    preparedComponents: (recipes || []).filter((row) => row.active !== false && row.recipe_type === "preparation").length,
    inactiveRecipes: (recipes || []).filter((row) => row.active === false).length,
  };
}

async function profileAfter(client) {
  const auth = await timed("auth.getUser", () => client.auth.getUser());
  const parallel = await timed("parallel.catalogue_slim", async () => {
    const started = performance.now();
    const results = await Promise.all([
      timed("categories.slim", () => client.from("categories").select("id,name_en,name_ar,sort_order,branch_id").eq("branch_id", BRANCH)),
      timed("sections.slim", () => client.from("sections").select("id,category_id,name_en,name_ar,sort_order,branch_id").eq("branch_id", BRANCH)),
      timed("menu_items.slim", () => client.from("menu_items").select("id,section_id,name_en,name_ar,sort_order,active,sold_out,hidden_until,placement_group_id,branch_id").eq("branch_id", BRANCH)),
      timed("recipes.slim", () => client.from("inventory_recipes").select("id,name,normalized_name,name_en,name_ar,internal_name,recipe_type,menu_item_id,placement_group_id,branch_id,output_quantity,output_unit,portion_count,portion_size,portion_unit,active,updated_at,updated_by,created_at")),
      timed("ingredients.slim", () => client.from("inventory_ingredients").select("id,canonical_name,active,base_inventory_unit,category,branch_id,scope")),
      timed("versions.slim", () => client.from("inventory_recipe_versions").select("id,recipe_id,version_number,status,documentation,updated_at")),
      timed("staff", () => client.from("ask_nac_staff").select("vault_role, primary_branch_id").ilike("email", STAFF_EMAIL).maybeSingle()),
      timed("branch_access", () => client.from("ask_nac_user_branch_access").select("branch_id").ilike("email", STAFF_EMAIL)),
    ]);
    return { wallMs: Math.round(performance.now() - started), results };
  });

  const byLabel = Object.fromEntries(parallel.result.results.map((entry) => [entry.label, entry.ms]));
  const payloadBytes = {
    menuItems: JSON.stringify(parallel.result.results[2].result.data || []).length,
    recipes: JSON.stringify(parallel.result.results[3].result.data || []).length,
    ingredients: JSON.stringify(parallel.result.results[4].result.data || []).length,
    versions: JSON.stringify(parallel.result.results[5].result.data || []).length,
  };

  const metrics = operationalMetrics(
    parallel.result.results[2].result.data,
    parallel.result.results[1].result.data,
    parallel.result.results[0].result.data,
    parallel.result.results[3].result.data,
  );

  return {
    mode: "after",
    operationalMetrics: metrics,
    branch: BRANCH,
    timingsMs: {
      authGetUser: auth.ms,
      parallelWall: parallel.result.wallMs,
      ...byLabel,
    },
    payloadBytes,
    requestCount: 1 + parallel.result.results.length,
    counts: {
      menuItems: (parallel.result.results[2].result.data || []).length,
      recipes: (parallel.result.results[3].result.data || []).length,
      ingredients: (parallel.result.results[4].result.data || []).length,
      versions: (parallel.result.results[5].result.data || []).length,
    },
  };
}

async function main() {
  const env = loadEnvLocal();
  const url = env.REACT_APP_SUPABASE_URL;
  const anon = env.REACT_APP_SUPABASE_ANON_KEY;
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const t0 = performance.now();
  const client = await signInStaff(url, anon, getServiceRole(projectRef));
  const signInMs = Math.round(performance.now() - t0);
  const report = MODE === "after" ? await profileAfter(client) : await profileBefore(client);
  report.signInMs = signInMs;
  report.authenticatedAs = STAFF_EMAIL;
  report.measuredAt = new Date().toISOString();
  const outDir = path.join(root, "tmp/food-bible-2026-08-20");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `load-profile-${MODE}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
