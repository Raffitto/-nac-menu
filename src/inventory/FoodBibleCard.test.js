import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FoodBibleCard from "./FoodBibleCard";
import {
  createRecipe,
  fetchRecipeBundle,
  linkRecipeToMenuItem,
  saveRecipeDraft,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  createRecipe: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeUsageCounts: jest.fn(),
  linkRecipeToMenuItem: jest.fn(),
  saveRecipeDraft: jest.fn(),
}));

const overview = {
  ingredients: [
    { id: "ing-1", canonicalName: "Heavy cream", baseInventoryUnit: "litre", active: true },
    { id: "ing-2", canonicalName: "Minced Beef", baseInventoryUnit: "gram", active: true },
  ],
  recipes: [
    { id: "cmp-1", name: "Lemon Confit Dressing", recipeType: "preparation", active: true },
  ],
  rows: [
    {
      kind: "menu_item",
      identityKey: "quinoa",
      displayName: "Quinoa",
      displayNameAr: "كينوا",
      menuItemId: "menu-q",
      categoryName: "Salads",
      placementSummary: "Daytime",
      guestStatus: "live",
      placements: [{ id: "menu-q" }],
    },
  ],
  lineGraph: {},
};

describe("FoodBibleCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchRecipeBundle.mockResolvedValue({
      recipe: {
        id: "r-q",
        name: "QUINOA, POMEGRANATE, BABY TOMATO, LEMON CONFIT DRESSING",
        recipeType: "menu_item",
        menuItemId: "menu-q",
        outputQuantity: "1",
        outputUnit: "each",
      },
      version: { id: "v1", documentation: { preparationMethod: "Season the quinoa." } },
      lines: [
        { id: "l1", ingredientId: "ing-2", quantity: "130", unit: "gram", preparationNote: "", subRecipeId: "" },
        { id: "l2", subRecipeId: "cmp-1", quantity: "10", unit: "gram", preparationNote: "", ingredientId: "" },
      ],
      stages: [],
    });
    saveRecipeDraft.mockResolvedValue({});
    createRecipe.mockResolvedValue({ recipe: { id: "r-new" }, version: { id: "v-new" }, lines: [], stages: [] });
    linkRecipeToMenuItem.mockResolvedValue({});
  });

  test("shows culinary card fields and opens a prepared component", async () => {
    const onOpenRecipe = jest.fn();
    render(
      <FoodBibleCard
        branchId="khobar"
        target={{ recipeId: "r-q", displayName: "Quinoa", kind: "menu_item" }}
        overview={overview}
        canEdit
        onClose={jest.fn()}
        onSaved={jest.fn()}
        onOpenRecipe={onOpenRecipe}
      />,
    );
    expect(await screen.findByTestId("food-bible-card")).toBeInTheDocument();
    expect(await screen.findByText(/QUINOA, POMEGRANATE/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-component-cmp-1"));
    expect(onOpenRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipeId: "cmp-1" }));
  });

  test("edits a line in place, saves, and does not invent a menu mapping", async () => {
    render(
      <FoodBibleCard
        branchId="khobar"
        target={{ recipeId: "r-q", displayName: "Quinoa" }}
        overview={overview}
        canEdit
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    await screen.findByTestId("food-bible-card-edit");
    fireEvent.click(screen.getByTestId("food-bible-card-edit"));
    fireEvent.change(screen.getByTestId("recipe-line-qty-0"), { target: { value: "120" } });
    fireEvent.click(screen.getByTestId("save-recipe-button"));
    await waitFor(() => expect(saveRecipeDraft).toHaveBeenCalled());
    expect(saveRecipeDraft.mock.calls[0][1].lines[0].quantity).toBe("120");
  });

  test("manual menu link requires confirm", async () => {
    render(
      <FoodBibleCard
        branchId="khobar"
        target={{ recipeId: "r-q", displayName: "Quinoa", linkKind: "inferred" }}
        overview={overview}
        canEdit
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    await screen.findByText("Needs menu confirmation");
    fireEvent.click(screen.getByTestId("food-bible-link-menu-button"));
    fireEvent.click(screen.getByTestId("food-bible-menu-link-option-menu-q"));
    fireEvent.click(screen.getByTestId("food-bible-menu-link-confirm"));
    await waitFor(() => expect(linkRecipeToMenuItem).toHaveBeenCalledWith("r-q", expect.objectContaining({ menuItemId: "menu-q" })));
  });
});
