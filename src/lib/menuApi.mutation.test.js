import { assertMenuMutation, verifyGuestMenuExpectation } from "./menuApi";

describe("assertMenuMutation", () => {
  test("maps PGRST116 coerce errors to a clear message", () => {
    expect(() =>
      assertMenuMutation(
        { error: { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" } },
        "applyMenuItemVisibility",
      ),
    ).toThrow("Menu item was not saved. Check branch access and try again.");
  });

  test("maps zero-row update errors to a readable message", () => {
    expect(() =>
      assertMenuMutation(
        {
          error: {
            code: "PGRST116",
            message:
              "No menu_items row updated for id abc. The record may not exist or your branch may not have edit access.",
          },
        },
        "updateMenuItem",
      ),
    ).toThrow("Menu item was not saved. Check branch access and try again.");
  });

  test("returns data on success", () => {
    const row = { id: "abc", sold_out: true };
    expect(assertMenuMutation({ data: row, error: null }, "toggleSoldOut")).toEqual(row);
  });
});

describe("verifyGuestMenuExpectation", () => {
  const menu = {
    menuData: {
      dinner: [
        {
          items: [
            {
              id: "tenderloin",
              en: "Tenderloin",
              price: "120 SAR",
              soldOut: false,
              featured: true,
              allergens: ["milk"],
            },
          ],
        },
      ],
    },
  };

  test("verifies allergen changes in the guest payload", () => {
    expect(
      verifyGuestMenuExpectation(menu, {
        type: "item",
        itemId: "tenderloin",
        present: true,
        allergens: ["milk"],
      }),
    ).toEqual({ ok: true });
  });

  test("rejects final success when the guest payload is stale", () => {
    expect(
      verifyGuestMenuExpectation(menu, {
        type: "item",
        itemId: "tenderloin",
        present: true,
        allergens: ["milk", "gluten"],
      }),
    ).toEqual({
      ok: false,
      message: "Guest menu allergens did not match the saved value.",
    });
  });

  test("verifies removed or disabled items are absent", () => {
    expect(
      verifyGuestMenuExpectation(menu, {
        type: "item",
        itemId: "removed-item",
        present: false,
      }),
    ).toEqual({ ok: true });
  });

  test("verifies featured highlight state in the guest payload", () => {
    expect(
      verifyGuestMenuExpectation(menu, {
        type: "item",
        itemId: "tenderloin",
        present: true,
        fields: { featured: true },
      }),
    ).toEqual({ ok: true });

    expect(
      verifyGuestMenuExpectation(menu, {
        type: "item",
        itemId: "tenderloin",
        present: true,
        fields: { featured: false },
      }),
    ).toEqual({
      ok: false,
      message: "Guest menu field featured did not match the saved value.",
    });
  });
});
