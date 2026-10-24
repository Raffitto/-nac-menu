// Executes the real menu API against an isolated in-memory PostgREST test double.
// No network, production credentials, RLS bypass, or historical deletes.
jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), auth: {
  getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: "local-editor" } } } }),
} } }));
import { supabase } from "./supabase";
import { createCategory, updateCategory, createSection, updateSection, createMenuItemPlacements,
  updateMenuItemPlacements, getFullMenu, toggleSoldOut, scheduleMenuItemHide,
  hideMenuItemPermanently, restoreMenuItemVisibility, patchLinkedPlacementMembers } from "./menuApi";

let store, serial;
const branches = ["khobar", "riyadh", "jeddah"];
function query(table) {
  let predicates = [], mode = "select", payload, one = false;
  const q = {
    select: () => q, order: () => q,
    eq: (key, value) => { predicates.push((r) => r[key] === value); return q; },
    in: (key, values) => { predicates.push((r) => values.includes(r[key])); return q; },
    insert: (value) => { mode = "insert"; payload = value; return q; },
    update: (value) => { mode = "update"; payload = value; return q; },
    delete: () => {
      if (!["item_addons", "item_allergens"].includes(table)) throw new Error("Historical deletes are forbidden in this integration test");
      mode = "delete"; return q;
    },
    single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; },
    then: (resolve, reject) => Promise.resolve().then(() => {
      const rows = store[table] || [];
      let result = rows.filter((r) => predicates.every((test) => test(r)));
      if (mode === "insert") {
        result = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `created-${++serial}`, ...r }));
        store[table] = [...rows, ...result];
      } else if (mode === "update") result.forEach((r) => Object.assign(r, payload));
      else if (mode === "delete") store[table] = rows.filter((r) => !result.includes(r));
      return { data: JSON.parse(JSON.stringify(one ? result[0] || null : result)), error: null };
    }).then(resolve, reject),
  };
  return q;
}
function flatten(menu) { return Object.values(menu.menuData).flatMap((sections) => sections.flatMap((s) => s.items)); }
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-24T10:00:00Z")); serial = 0;
  localStorage.clear();
  store = { categories: [], sections: [], menu_items: [], item_addons: [], item_allergens: [],
    add_ons: [], allergens: [], inventory_recipes: [{ id: "recipe-protected", menu_item_id: "historic-item" }],
    inventory_recipe_versions: [{ id: "version-protected", status: "active", recipe_id: "recipe-protected" }],
    inventory_recipe_version_lines: [{ id: "line-protected", quantity: 95, ingredient_id: "ingredient-protected" }] };
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "local-editor" } } }, error: null });
  supabase.from.mockImplementation(query);
});
afterEach(() => jest.useRealTimers());

test.each(branches)("%s creation/editing/category/section/placement/English/Arabic reaches the guest without recipe mutation", async (branch) => {
  const protectedState = JSON.stringify([store.inventory_recipes, store.inventory_recipe_versions, store.inventory_recipe_version_lines]);
  const { data: category } = await createCategory({ slug: "breakfast", branch_id: branch, active: true, name_en: "Breakfast", name_ar: "الفطور" });
  await updateCategory(category.id, { name_en: "Morning", name_ar: "الصباح" });
  const { data: a } = await createSection({ category_id: category.id, branch_id: branch, active: true, name_en: "Eggs", name_ar: "بيض" });
  const { data: b } = await createSection({ category_id: category.id, branch_id: branch, active: true, name_en: "Plates", name_ar: "أطباق" });
  await updateSection(b.id, { name_ar: "أطباق الصباح" });
  store.add_ons = [{ id: "addon", slug: "extra", active: true, name_en: "Extra", name_ar: "إضافة", price: "5 SAR" }];
  store.allergens = [{ id: "allergen", code: "d", name_en: "Dairy", name_ar: "حليب" }];
  const { data: primary, created, placementGroupId } = await createMenuItemPlacements({
    contentPayload: { branch_id: branch, active: true, name_en: "2 Eggs Any Style", name_ar: "٢ بيض", desc_en: "Fried, scrambled or poached.", desc_ar: "مقلي، مخفوق أو مسلوق", price: "31 SAR", calories: 461.4 },
    primarySectionId: a.id, extraSectionIds: [b.id], addonIds: ["addon"], allergenIds: ["allergen"],
  });
  expect(created).toHaveLength(2);
  let menu = (await getFullMenu({ branchId: branch })).data;
  expect(flatten(menu)).toHaveLength(2);
  expect(flatten(menu)[0].preparations).toHaveLength(3);
  expect(flatten(menu)[0].selectedPreparationId).toBe("scrambled");
  expect(flatten(menu)[0].recommended[0]).toMatchObject({ en: "Extra", ar: "إضافة", price: "5 SAR" });
  expect(flatten(menu).every((i) => i.allergens.includes("d"))).toBe(true);
  expect(flatten(menu)[0].ar).toBe("٢ بيض");
  expect(menu.categories[0]).toMatchObject({ en: "Morning", ar: "الصباح" });
  await updateMenuItemPlacements({ itemId: primary.id, primarySectionId: a.id, placementGroupId, syncLinked: true,
    contentPayload: { branch_id: branch, desc_en: "Updated", desc_ar: "وصف محدث", price: "31 SAR" } });
  // Cached branch data must be invalidated by the edit, without an explicit bypass.
  menu = (await getFullMenu({ branchId: branch })).data;
  expect(flatten(menu).every((i) => i.descEn === "Updated" && i.descAr === "وصف محدث")).toBe(true);
  expect(flatten(menu).every((i) => i.branch_id === branch)).toBe(true);
  for (const other of branches.filter((b) => b !== branch)) expect(flatten((await getFullMenu({ branchId: other })).data)).toEqual([]);
  expect(JSON.stringify([store.inventory_recipes, store.inventory_recipe_versions, store.inventory_recipe_version_lines])).toBe(protectedState);
});

test.each(branches)("%s sold-out stays visible, timed hide has wake-up metadata and restores after expiry", async (branch) => {
  store.categories = [{ id: "cat", slug: "daytime", branch_id: branch, active: true }];
  store.sections = [{ id: "sec", category_id: "cat", branch_id: branch, active: true }];
  store.menu_items = [{ id: "item", section_id: "sec", branch_id: branch, active: true, name_en: "Dish", price: "59 SAR" }];
  await toggleSoldOut("item", true);
  expect(flatten((await getFullMenu({ branchId: branch })).data)[0].soldOut).toBe(true);
  const expiry = Date.now() + 60000;
  await scheduleMenuItemHide("item", new Date(expiry).toISOString());
  let response = await getFullMenu({ branchId: branch });
  expect(flatten(response.data)).toHaveLength(0);
  expect(response.data.visibilityExpiryMs).toBe(expiry);
  jest.setSystemTime(expiry + 1);
  response = await getFullMenu({ branchId: branch, bypassCache: true });
  expect(flatten(response.data)[0]).toMatchObject({ id: "item", soldOut: true });
  await hideMenuItemPermanently("item");
  expect(flatten((await getFullMenu({ branchId: branch })).data)).toHaveLength(0);
  await restoreMenuItemVisibility("item");
  expect(flatten((await getFullMenu({ branchId: branch })).data)).toHaveLength(1);
});

test("linked group collisions cannot overwrite another branch price/availability or a distinct portion group", async () => {
  store.menu_items = [
    { id: "kh", branch_id: "khobar", placement_group_id: "group", price: "59 SAR", active: true },
    { id: "kh2", branch_id: "khobar", placement_group_id: "group", price: "59 SAR", active: true },
    { id: "ry", branch_id: "riyadh", placement_group_id: "group", price: "61 SAR", active: true },
    { id: "small", branch_id: "khobar", placement_group_id: "small-group", price: "45 SAR", active: true },
  ];
  const other = JSON.stringify(store.menu_items.slice(2));
  await patchLinkedPlacementMembers("kh", { price: "60 SAR", sold_out: true });
  expect(store.menu_items.slice(0, 2).every((i) => i.price === "60 SAR" && i.sold_out)).toBe(true);
  expect(JSON.stringify(store.menu_items.slice(2))).toBe(other);
  await updateMenuItemPlacements({ itemId: "kh", primarySectionId: "sec", placementGroupId: "group", syncLinked: true, contentPayload: { price: "62 SAR" } });
  expect(store.menu_items.slice(0, 2).every((i) => i.price === "62 SAR")).toBe(true);
  const rejected = await updateMenuItemPlacements({ itemId: "kh", primarySectionId: "sec", placementGroupId: "group", contentPayload: { branch_id: "riyadh", price: "1 SAR" } });
  expect(rejected.error.message).toContain("another branch");
  expect(store.menu_items[0].branch_id).toBe("khobar");
  expect(JSON.stringify(store.menu_items.slice(2))).toBe(other);
});
