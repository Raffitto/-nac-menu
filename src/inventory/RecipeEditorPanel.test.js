import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RecipeEditorPanel from "./RecipeEditorPanel";
import {
  createRecipe,
  fetchRecipeBundle,
  fetchRecipeUsageCounts,
  saveRecipeDraft,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  createRecipe: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeUsageCounts: jest.fn(),
  saveRecipeDraft: jest.fn(),
  setRecipeActive: jest.fn(),
}));

const overview = {
  ingredients: [
    { id: "ing-1", canonicalName: "Heavy cream", baseInventoryUnit: "litre", active: true },
  ],
  recipes: [
    { id: "cmp-1", name: "Hollandaise", recipeType: "preparation", active: true },
  ],
};

describe("RecipeEditorPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchRecipeUsageCounts.mockResolvedValue({});
    window.confirm = jest.fn(() => true);
  });

  test("creates and saves a draft recipe", async () => {
    createRecipe.mockResolvedValue({
      recipe: { id: "recipe-new", active: true },
      version: { id: "version-new" },
      lines: [],
      stages: [],
    });
    saveRecipeDraft.mockResolvedValue({});
    const onSaved = jest.fn();
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ kind: "menu_item", displayName: "Burrata", menuItemId: "menu-1" }}
        overview={overview}
        canEditBranch
        canEditNetwork={false}
        onClose={jest.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByTestId("recipe-name-input"), { target: { value: "[TEMP VERIFY] Draft" } });
    fireEvent.change(screen.getByTestId("recipe-yield-quantity-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByTestId("save-recipe-button"));
    await waitFor(() => {
      expect(createRecipe).toHaveBeenCalled();
      expect(saveRecipeDraft).toHaveBeenCalled();
      expect(onSaved).toHaveBeenCalled();
    });
  });

  test("validates required fields before save", async () => {
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ kind: "new_component" }}
        overview={overview}
        canEditBranch
        canEditNetwork={false}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("save-recipe-button"));
    expect(await screen.findByTestId("recipe-editor-error")).toHaveTextContent("Recipe name is required.");
    expect(createRecipe).not.toHaveBeenCalled();
  });

  test("warns before closing with unsaved changes", async () => {
    const onClose = jest.fn();
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ kind: "new_component" }}
        overview={overview}
        canEditBranch
        canEditNetwork={false}
        onClose={onClose}
        onSaved={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("recipe-name-input"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByLabelText("Close editor"));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  test("loads existing recipe bundle for edit", async () => {
    fetchRecipeBundle.mockResolvedValue({
      recipe: {
        id: "recipe-1",
        name: "Hollandaise",
        recipeType: "preparation",
        outputQuantity: "1000",
        outputUnit: "gram",
        active: true,
      },
      version: { id: "version-1", documentation: { preparationMethod: "Whisk." } },
      lines: [{
        id: "line-1",
        ingredientId: "ing-1",
        quantity: "500",
        unit: "millilitre",
        wastePercentage: 0,
      }],
      stages: [],
    });
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ recipeId: "recipe-1", displayName: "Hollandaise" }}
        overview={overview}
        canEditBranch
        canEditNetwork={false}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    expect(await screen.findByTestId("recipe-name-input")).toHaveValue("Hollandaise");
    expect(screen.getByTestId("recipe-readiness-checklist")).toBeInTheDocument();
  });

  test("rejects circular component selection", async () => {
    fetchRecipeBundle.mockResolvedValue({
      recipe: { id: "recipe-1", name: "Sauce", recipeType: "preparation", outputQuantity: "1", outputUnit: "litre", active: true },
      version: { id: "version-1", documentation: {} },
      lines: [{ id: "line-1", clientId: "line-1", ingredientId: "", subRecipeId: "", quantity: "1", unit: "litre" }],
      stages: [],
    });
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ recipeId: "recipe-1", displayName: "Sauce" }}
        overview={{
          ...overview,
          recipes: [
            { id: "recipe-1", name: "Sauce", recipeType: "preparation", active: true },
            { id: "recipe-2", name: "Base", recipeType: "preparation", active: true },
          ],
          lineGraph: {
            "recipe-1": [],
            "recipe-2": [{ subRecipeId: "recipe-1" }],
          },
        }}
        canEditBranch
        canEditNetwork={false}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    expect(await screen.findByTestId("recipe-name-input")).toHaveValue("Sauce");
    const select = screen.getAllByLabelText("Ingredient or component")[0];
    fireEvent.change(select, { target: { value: "cmp:recipe-2" } });
    expect(await screen.findByTestId("recipe-editor-error")).toHaveTextContent(/circular/i);
  });
});
