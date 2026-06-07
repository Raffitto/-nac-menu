import { buildAddonSlug, formatAddonPrice, sanitizeAddonPayload, buildAddonsByItemFromJunctions, isPublicAddonVisible } from "./menuApi";

describe("menu add-on payload", () => {
  test("buildAddonSlug camelCases English name", () => {
    expect(buildAddonSlug("Cornflakes")).toBe("cornflakes");
    expect(buildAddonSlug("Add Chicken")).toBe("addChicken");
    expect(buildAddonSlug("Monterey Jack Cheese")).toBe("montereyJackCheese");
  });

  test("formatAddonPrice stores SAR text", () => {
    expect(formatAddonPrice("6")).toBe("6 SAR");
    expect(formatAddonPrice("6 SAR")).toBe("6 SAR");
    expect(formatAddonPrice("")).toBe("-");
  });

  test("sanitizeAddonPayload includes required fields for insert", () => {
    const payload = sanitizeAddonPayload(
      { name_en: "Cornflakes", name_ar: "كورن فليكس", price: "6" },
      { slug: "cornflakes" },
    );
    expect(payload.slug).toBe("cornflakes");
    expect(payload.name_en).toBe("Cornflakes");
    expect(payload.name_ar).toBe("كورن فليكس");
    expect(payload.price).toBe("6 SAR");
    expect(payload.active).toBe(true);
  });

  test("inactive add-ons are excluded from public item mapping", () => {
    const addonById = {
      a1: { id: "a1", name_en: "Cornflakes", active: false, price: "6 SAR" },
      a2: { id: "a2", name_en: "Dark Chocolate", active: true, price: "6 SAR" },
    };
    const byItem = buildAddonsByItemFromJunctions(
      [
        { item_id: "cookie-1", addon_id: "a1" },
        { item_id: "cookie-1", addon_id: "a2" },
      ],
      addonById,
    );
    expect(byItem["cookie-1"].map((a) => a.name_en)).toEqual(["Dark Chocolate"]);
    expect(isPublicAddonVisible(addonById.a1)).toBe(false);
  });

  test("fallback junction rows cannot override inactive database add-ons", () => {
    const byItem = buildAddonsByItemFromJunctions(
      [{ item_id: "cookie-1", addon_id: "missing", add_ons: { name_en: "Cornflakes", active: false } }],
      {},
    );
    expect(byItem["cookie-1"] || []).toHaveLength(0);
  });
});
