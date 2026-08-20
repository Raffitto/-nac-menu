import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FoodBibleOsView from "./FoodBibleOsView";
import { PlatformFiltersProvider } from "../context/PlatformFiltersContext";
import { RbacProvider } from "../context/RbacContext";
import { fetchFoodBibleOverview, fetchInventoryStaffAccess, fetchCanonicalCostContext } from "../../lib/inventoryApi";
import { READINESS } from "../../inventory/foodBible";

jest.mock("../../lib/inventoryApi", () => ({
  fetchFoodBibleOverview: jest.fn(),
  fetchCanonicalCostContext: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  fetchRecipeBundle: jest.fn(),
  fetchRecipeUsageCounts: jest.fn(),
  saveRecipeDraft: jest.fn(),
  createRecipe: jest.fn(),
  setRecipeActive: jest.fn(),
}));

jest.mock("../../inventory/RecipeEditorPanel", () => ({
  __esModule: true,
  default: ({ target, onClose }) => (
    <div data-testid="recipe-editor-panel">
      Editor for {target.displayName}
      <button type="button" onClick={onClose}>Close editor</button>
    </div>
  ),
}));

const overview = {
  summary: { totalMenuItems: 5, complete: 4, inProgress: 0, missing: 1, needsAttention: 0, coveragePct: 80 },
  rows: [
    { kind: "menu_item", identityKey: "big-nac", displayName: "Big NAC", recipeId: "r-big", guestStatus: "live", readiness: READINESS.READY, categoryName: "Burgers", recipeType: "menu_item", lineCount: 8, yieldSummary: "1 each", lines: [{ name: "Minced Beef", quantity: 160, unit: "gram" }], costTrustStatus: "UNRELIABLE", costCompletenessPct: 0 },
    { kind: "menu_item", identityKey: "seabass", displayName: "Pan Seared Seabass", recipeName: "SEA BASS CREOLE WITH PEPPER CREAM SAUCE", recipeId: "r-bass", guestStatus: "live", readiness: READINESS.READY, categoryName: "Mains", recipeType: "menu_item", lineCount: 4, yieldSummary: "1 each", lines: [], costTrustStatus: "UNRELIABLE", costCompletenessPct: 0 },
    { kind: "menu_item", identityKey: "rendang", displayName: "King Prawn Rendang", recipeName: "Prawn Rendang, grilled lemon", recipeId: "r-rendang", guestStatus: "live", readiness: READINESS.READY, categoryName: "Mains", recipeType: "menu_item", lineCount: 11, yieldSummary: "1 each", lines: [], costTrustStatus: "UNRELIABLE", costCompletenessPct: 0 },
    { kind: "menu_item", identityKey: "melon", displayName: "Watermelon & Cucumber", recipeId: "r-melon", guestStatus: "live", readiness: READINESS.READY, categoryName: "Starters", recipeType: "menu_item", lineCount: 8, yieldSummary: "1 each", lines: [], costTrustStatus: "UNRELIABLE", costCompletenessPct: 0 },
    { kind: "menu_item", identityKey: "conchiglie", displayName: "Conchiglie", guestStatus: "live", readiness: READINESS.MISSING, categoryName: "Pasta", recipeType: "menu_item", lineCount: 0, yieldSummary: "—", lines: [], costTrustStatus: "UNRELIABLE", costCompletenessPct: 0 },
    { kind: "archived", identityKey: "bircher", displayName: "APPLE BIRCHER MUESLI", recipeId: "r-bircher", guestStatus: "archived", readiness: READINESS.READY, categoryName: "Archived recipes", recipeType: "menu_item", lineCount: 6, yieldSummary: "1 each", lines: [], costTrustStatus: "UNRELIABLE", costCompletenessPct: 0 },
  ],
  recipes: [],
  ingredients: [{ id: "ing-1", canonicalName: "Minced Beef", active: true }],
  hasActiveIngredients: true,
};

function renderOs() {
  return render(
    <PlatformFiltersProvider>
      <RbacProvider session={{ user: { email: "raffi@nac.com" } }}>
        <FoodBibleOsView />
      </RbacProvider>
    </PlatformFiltersProvider>,
  );
}

describe("FoodBibleOsView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchFoodBibleOverview.mockResolvedValue(overview);
    fetchCanonicalCostContext.mockResolvedValue({ costByCanonicalId: {} });
    fetchInventoryStaffAccess.mockResolvedValue({
      vaultRole: "ops_manager",
      primaryBranchId: "khobar",
      branchIds: ["khobar", "riyadh", "jeddah"],
    });
  });

  test("renders Food Bible inside NAC OS and shows canonical recipe states", async () => {
    renderOs();
    expect(screen.getByTestId("nacos-food-bible")).toBeInTheDocument();
    await waitFor(() => expect(fetchFoodBibleOverview).toHaveBeenCalledWith(expect.objectContaining({ branchId: "khobar" })));
    expect(await screen.findByText("Big NAC")).toBeInTheDocument();
    expect(screen.getByText("Pan Seared Seabass")).toBeInTheDocument();
    expect(screen.getByText("King Prawn Rendang")).toBeInTheDocument();
    expect(screen.getByText("Watermelon & Cucumber")).toBeInTheDocument();
    expect(screen.getByText("Conchiglie")).toBeInTheDocument();
    expect(screen.getByTestId("food-bible-row-conchiglie")).toHaveTextContent("Missing recipe");
    fireEvent.change(screen.getByTestId("food-bible-menu-filter"), { target: { value: "active" } });
    expect(screen.getByText("Big NAC")).toBeInTheDocument();
    expect(screen.queryByText("APPLE BIRCHER MUESLI")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("food-bible-menu-filter"), { target: { value: "archived" } });
    expect(await screen.findByText("APPLE BIRCHER MUESLI")).toBeInTheDocument();
  });
});
