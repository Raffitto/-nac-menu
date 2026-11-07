import { CONFIRMED_MENU_VARIANTS, resolveConfirmedMenuIdentity } from "./menuIdentity";
import { withEggPreparations } from "./eggPreparation";
import checkpoint from "../../scripts/reconciliation/checkpoint.json";

test("all confirmed placements resolve exact observed rows and preserve variant boundaries", () => {
  const ids = CONFIRMED_MENU_VARIANTS.flatMap((v) => v.placementIds);
  expect(new Set(ids).size).toBe(ids.length);
  for (const variant of CONFIRMED_MENU_VARIANTS) {
    for (const id of variant.placementIds) {
      const row = checkpoint.menuItems.find((i) => i.id === id);
      expect(row).toBeDefined();
      expect(resolveConfirmedMenuIdentity({ ...row, name_en: "Changed label", price: "1", calories: "0" })).toBe(variant);
    }
  }
  const quinoa = CONFIRMED_MENU_VARIANTS.filter((v) => v.productKey === "nac:quinoa");
  expect(quinoa).toHaveLength(2);
  expect(new Set(quinoa.map((v) => v.variantKey)).size).toBe(2);
  expect(new Set(quinoa.map((v) => v.foodicsProductId)).size).toBe(2);
});

test("names, prices, tags, clone hints and proposed bindings cannot fabricate confirmed identity", () => {
  expect(resolveConfirmedMenuIdentity({ id: "new", name_en: "Big NAC", price: 69, calories: 1115, tags: ["NAC"] })).toBeNull();
  checkpoint.proposedBindings.forEach((r) => expect(resolveConfirmedMenuIdentity({ id: r.digital_item_id })).toBeNull());
  expect(resolveConfirmedMenuIdentity({ id: "new", cloned_from_id: CONFIRMED_MENU_VARIANTS[0].placementIds[0] })).toBeNull();
});

test("confirmed eggs keep preparation controls after text/nutrition edits, while the bun stays separate", () => {
  const egg = CONFIRMED_MENU_VARIANTS.find((v) => v.foodicsSku === "sk-1320");
  const row = { id: egg.placementIds[0], en: "Renamed eggs", price: "32 SAR", calories: 500 };
  const prepared = withEggPreparations(row);
  expect(prepared.selectedPreparationId).toBe("scrambled");
  expect(prepared.price).toBe("32 SAR");
  expect(prepared.id).toBe(row.id);
  const bun = CONFIRMED_MENU_VARIANTS.find((v) => v.foodicsSku === "sk-1321");
  expect(withEggPreparations({ ...row, id: bun.placementIds[0] }).preparations).toBeUndefined();
});

test("conflicting branch or historical SKU cannot gain confirmed egg controls through legacy fallback", () => {
  const egg = CONFIRMED_MENU_VARIANTS.find((v) => v.foodicsSku === "sk-1320");
  const row = { id: egg.placementIds[0], en: "2 Eggs Any Style", price: "31 SAR", calories: 461.4 };
  expect(withEggPreparations({ ...row, branch_id: "riyadh" }).preparations).toBeUndefined();
  expect(withEggPreparations({ ...row, product_sku: "sk-other" }).preparations).toBeUndefined();
});
