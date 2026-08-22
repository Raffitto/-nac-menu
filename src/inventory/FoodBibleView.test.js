import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FoodBibleView from "./FoodBibleView";
import { fetchFoodBibleOverview, fetchInventoryStaffAccess, fetchCanonicalCostContext, fetchRecipeBundle } from "../lib/inventoryApi";
import { CATALOGUE_SCOPES, READINESS } from "./foodBible";

jest.mock("../lib/inventoryApi", () => ({
  createRecipe: jest.fn(),
  fetchFoodBibleOverview: jest.fn(),
  fetchCanonicalCostContext: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeUsageCounts: jest.fn(),
  saveRecipeDraft: jest.fn(),
  setRecipeActive: jest.fn(),
}));

jest.mock("./FoodBibleCard", () => ({
  __esModule: true,
  default: ({ target, onClose }) => (
    <div data-testid="food-bible-card">
      Card for {target.displayName}
      <button type="button" onClick={onClose}>Close editor</button>
    </div>
  ),
}));

const managerAccess = {
  vaultRole: "branch_manager",
  primaryBranchId: "khobar",
  branchIds: ["khobar"],
};

const overview = {
  summary: {
    totalMenuItems: 1,
    liveKitchenItems: 1,
    complete: 0,
    inProgress: 0,
    incomplete: 0,
    missing: 1,
    needsAttention: 0,
    mapped: 0,
    coveragePct: 0,
    fullyCosted: 0,
    partiallyCosted: 0,
    uncosted: 1,
    costCoveragePct: 0,
  },
  rows: [
    {
      kind: "menu_item",
      identityKey: "menu-1",
      displayName: "Burrata",
      displayNameAr: "بوراتا",
      recipeType: "menu_item",
      categoryName: "Mains",
      guestStatus: "live",
      requiresKitchenRecipe: true,
      readiness: READINESS.MISSING,
      lineCount: 0,
      yieldSummary: "—",
      placements: [{ id: "menu-1" }, { id: "menu-1b" }],
    },
    {
      kind: "menu_item",
      identityKey: "menu-2",
      displayName: "Iced Spanish Latte",
      displayNameAr: "لاتيه",
      recipeType: "menu_item",
      categoryName: "Drinks",
      guestStatus: "sold_out",
      requiresKitchenRecipe: false,
      readiness: READINESS.MISSING,
      lineCount: 0,
      yieldSummary: "—",
      placements: [{ id: "menu-2" }],
    },
  ],
  recipes: [],
  ingredients: [],
  hasActiveIngredients: false,
  detailsDeferred: true,
};

describe("FoodBibleView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchFoodBibleOverview.mockResolvedValue(overview);
    fetchCanonicalCostContext.mockResolvedValue({ costByCanonicalId: {} });
    fetchRecipeBundle.mockResolvedValue({
      recipe: { name: "Burrata" },
      version: { documentation: { preparationMethod: "Plate." } },
      lines: [{ ingredientId: "ing-1", name: "Cream", quantity: 1, unit: "litre" }],
      stages: [],
    });
    fetchInventoryStaffAccess.mockResolvedValue(managerAccess);
  });

  test("loads overview metrics and menu rows", async () => {
    render(<FoodBibleView branchId="khobar" />);
    await waitFor(() => {
      expect(screen.getByTestId("food-bible-metric-total")).toHaveTextContent("1");
      expect(screen.getByTestId("food-bible-metric-missing")).toHaveTextContent("1");
      expect(screen.getByTestId("food-bible-metric-coverage")).toHaveTextContent("0%");
    });
    expect(screen.getByText("Burrata")).toBeInTheDocument();
    expect(screen.queryByText("Iced Spanish Latte")).not.toBeInTheDocument();
    expect(screen.getByText(/Appears in 2 menu placements/)).toBeInTheDocument();
    expect(screen.queryByText(/Unreliable/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("food-bible-menu-filter"), { target: { value: CATALOGUE_SCOPES.DRINKS } });
    expect(screen.getByText("Iced Spanish Latte")).toBeInTheDocument();
  });

  test("filters by readiness and search", async () => {
    fetchFoodBibleOverview.mockResolvedValue({
      ...overview,
      rows: [
        ...overview.rows,
        {
          kind: "component",
          identityKey: "recipe-1",
          displayName: "Hollandaise",
          recipeType: "preparation",
          categoryName: "Kitchen components",
          readiness: READINESS.DRAFT,
          lineCount: 2,
          yieldSummary: "1000 gram",
          guestStatus: null,
        },
      ],
      recipes: [{ id: "recipe-1", recipeType: "preparation", active: true }],
    });
    render(<FoodBibleView branchId="khobar" />);
    await screen.findByText("Burrata");
    fireEvent.change(screen.getByTestId("food-bible-menu-filter"), { target: { value: CATALOGUE_SCOPES.COMPONENTS } });
    expect(await screen.findByText("Hollandaise")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("food-bible-readiness-filter"), { target: { value: READINESS.DRAFT } });
    expect(screen.getByText("Hollandaise")).toBeInTheDocument();
    expect(screen.queryByText("Burrata")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("food-bible-readiness-filter"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("food-bible-menu-filter"), { target: { value: CATALOGUE_SCOPES.KITCHEN } });
    fireEvent.change(screen.getByTestId("food-bible-search-input"), { target: { value: "burrata" } });
    expect(await screen.findByText("Burrata")).toBeInTheDocument();
  });

  test("shows ingredient shortcut when no active ingredients exist", async () => {
    const onOpenIngredients = jest.fn();
    render(<FoodBibleView branchId="khobar" onOpenIngredients={onOpenIngredients} />);
    await screen.findByText("Burrata");
    expect(screen.queryByTestId("food-bible-empty-state")).not.toBeInTheDocument();
  });

  test("shows download actions for recipes", async () => {
    URL.createObjectURL = jest.fn(() => "blob:recipe");
    URL.revokeObjectURL = jest.fn();
    fetchFoodBibleOverview.mockResolvedValue({
      ...overview,
      rows: [{
        ...overview.rows[0],
        recipeId: "recipe-1",
        guestStatus: "live",
        kind: "menu_item",
        lines: [{ name: "Cream", quantity: 1, unit: "litre", ingredientId: "ing-1" }],
      }],
    });
    render(<FoodBibleView branchId="khobar" />);
    await screen.findByText("Burrata");
    fireEvent.click(screen.getByTestId("food-bible-export-button"));
    expect(screen.getByTestId("food-bible-export-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("food-bible-export-type-recipe_book")).toBeInTheDocument();
    expect(screen.getByTestId("food-bible-export-type-food_bible")).toBeInTheDocument();
    expect(screen.getByTestId("download-food-bible-button")).toBeInTheDocument();
    expect(screen.getByTestId("download-selected-recipes-button")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("download-recipe-menu-1"));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    URL.createObjectURL.mockClear();
    fireEvent.click(screen.getByTestId("select-recipe-menu-1"));
    fireEvent.click(screen.getByTestId("download-selected-recipes-button"));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  test("opens recipe editor from a menu row", async () => {
    render(<FoodBibleView branchId="khobar" />);
    await screen.findByText("Burrata");
    fireEvent.click(screen.getByTestId("open-recipe-editor-menu-1"));
    expect(screen.getByTestId("food-bible-card")).toHaveTextContent("Burrata");
  });

  test("read-only users cannot document recipes", async () => {
    fetchInventoryStaffAccess.mockResolvedValue({ vaultRole: "viewer", branchIds: ["khobar"] });
    render(<FoodBibleView branchId="khobar" />);
    await screen.findByText("Burrata");
    expect(screen.queryByTestId("create-component-recipe-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-recipe-editor-menu-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("food-bible-result-count")).toHaveTextContent("Read-only access");
  });
});
