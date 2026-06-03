import { buildAddonSlug, formatAddonPrice, sanitizeAddonPayload } from "./menuApi";

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
});
