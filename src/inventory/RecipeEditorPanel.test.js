import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RecipeEditorPanel from "./RecipeEditorPanel";
import {
  activateRecipeVersion,
  createRecipe,
  fetchRecipeBundle,
  fetchRecipeCostTrust,
  fetchRecipeUsageCounts,
  saveRecipeDraft,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  activateRecipeVersion: jest.fn(),
  createRecipe: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeCostTrust: jest.fn(),
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
    fetchRecipeCostTrust.mockResolvedValue(null);
    window.confirm = jest.fn(() => true);
    window.prompt = jest.fn();
  });

  test("creates and saves a draft recipe", async () => {
    createRecipe.mockResolvedValue({
      recipe: { id: "recipe-new", active: true },
      version: { id: "version-new" },
      lines: [],
      stages: [],
    });
    saveRecipeDraft.mockResolvedValue({
      recipe: { id: "recipe-new", active: true },
      version: { id: "version-new", status: "draft" },
    });
    activateRecipeVersion.mockResolvedValue({});
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
      expect(activateRecipeVersion).toHaveBeenCalledWith(expect.objectContaining({
        recipeVersionId: "version-new",
        reason: "Save changes — effective now",
      }));
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
    fetchRecipeCostTrust.mockResolvedValue({
      businessDate: "2026-07-20",
      trustStatus: "TRUSTED",
      completenessPct: 100,
      totalCost: 12,
      costPerPortion: 3,
      resolvedLines: 1,
      totalCostBearingLines: 1,
      missingComponents: [],
      lines: [{
        lineId: "line-1",
        itemName: "Heavy cream",
        normalizedBaseQuantity: 0.5,
        normalizedBaseUnit: "litre",
        historicalUnitCost: 24,
        extendedLineCost: 12,
        costStatus: "VALID_COST",
      }],
    });
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
    expect(await screen.findByTestId("recipe-cost-trust-detail")).toHaveTextContent("SAR 3.00");
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

  test("quantity edit is saved with the draft payload", async () => {
    fetchRecipeBundle.mockResolvedValue({
      recipe: { id: "recipe-1", name: "Big NAC", recipeType: "menu_item", outputQuantity: "1", outputUnit: "each", active: true },
      version: { id: "version-1", status: "active", documentation: {} },
      lines: [{ id: "line-1", clientId: "line-1", ingredientId: "ing-1", quantity: "180", unit: "gram" }],
      stages: [],
    });
    saveRecipeDraft.mockResolvedValue({
      recipe: { id: "recipe-1" },
      version: { id: "version-2", status: "draft" },
    });
    activateRecipeVersion.mockResolvedValue({});
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ recipeId: "recipe-1", displayName: "Big NAC", menuItemId: "menu-1" }}
        overview={overview}
        canEditBranch
        canEditNetwork={false}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />,
    );
    const qty = await screen.findByDisplayValue("180");
    fireEvent.change(qty, { target: { value: "170" } });
    fireEvent.click(screen.getByTestId("save-recipe-button"));
    await waitFor(() => expect(saveRecipeDraft).toHaveBeenCalled());
    const payload = saveRecipeDraft.mock.calls[0][1];
    expect(payload.lines[0].quantity).toBe("170");
  });

  test("activates a saved draft with reason and effective business date", async () => {
    fetchRecipeBundle.mockResolvedValue({
      recipe: {
        id: "recipe-1",
        name: "Hollandaise",
        recipeType: "preparation",
        outputQuantity: "1000",
        outputUnit: "gram",
        active: true,
      },
      version: {
        id: "version-2",
        status: "draft",
        outputQuantity: "1000",
        outputUnit: "gram",
        documentation: {},
      },
      lines: [{ id: "line-1", ingredientId: "ing-1", quantity: "1", unit: "litre" }],
      stages: [],
    });
    window.prompt
      .mockReturnValueOnce("Approved kitchen standard")
      .mockReturnValueOnce("2026-08-10");
    activateRecipeVersion.mockResolvedValue({});
    const onSaved = jest.fn();
    render(
      <RecipeEditorPanel
        branchId="khobar"
        target={{ recipeId: "recipe-1", displayName: "Hollandaise" }}
        overview={overview}
        canEditBranch
        canEditNetwork={false}
        onClose={jest.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(await screen.findByTestId("recipe-apply-now"));
    fireEvent.click(await screen.findByTestId("activate-recipe-version-button"));
    await waitFor(() => expect(activateRecipeVersion).toHaveBeenCalledWith({
      recipeVersionId: "version-2",
      effectiveFrom: "2026-08-10T00:00:00+03:00",
      reason: "Approved kitchen standard",
    }));
    expect(onSaved).toHaveBeenCalled();
  });
});
