import { assertMenuMutation } from "./menuApi";

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
