import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import IngredientMasterView from "./IngredientMasterView";
import {
  createIngredient,
  fetchIngredientDependencySummary,
  fetchIngredients,
  fetchInventoryStaffAccess,
  findDuplicateIngredient,
  setIngredientActive,
  updateIngredient,
} from "../lib/inventoryApi";

jest.mock("../lib/inventoryApi", () => ({
  createIngredient: jest.fn(),
  fetchIngredientDependencySummary: jest.fn(),
  fetchIngredients: jest.fn(),
  fetchInventoryStaffAccess: jest.fn(),
  findDuplicateIngredient: jest.fn(),
  setIngredientActive: jest.fn(),
  updateIngredient: jest.fn(),
}));

const managerAccess = {
  email: "manager@nac.test",
  vaultRole: "branch_manager",
  primaryBranchId: "khobar",
  branchIds: ["khobar"],
};

const readOnlyAccess = {
  email: "viewer@nac.test",
  vaultRole: "viewer",
  primaryBranchId: "khobar",
  branchIds: ["khobar"],
};

const sampleIngredients = [
  {
    id: "ing-1",
    canonicalName: "Heavy cream",
    category: "Dairy",
    baseInventoryUnit: "litre",
    description: "35% cream",
    scope: "branch",
    branchId: "khobar",
    active: true,
    updatedAt: "2026-07-15T10:00:00.000Z",
  },
  {
    id: "ing-2",
    canonicalName: "Tomato",
    category: "Produce",
    baseInventoryUnit: "kilogram",
    description: null,
    scope: "branch",
    branchId: "khobar",
    active: false,
    updatedAt: "2026-07-10T10:00:00.000Z",
  },
];

describe("IngredientMasterView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchIngredients.mockResolvedValue(sampleIngredients);
    fetchInventoryStaffAccess.mockResolvedValue(managerAccess);
    fetchIngredientDependencySummary.mockResolvedValue({ hasDependencies: false, movementCount: 0, catalogueCount: 0, receiptCount: 0 });
    findDuplicateIngredient.mockResolvedValue(null);
    createIngredient.mockResolvedValue({ id: "ing-new" });
    updateIngredient.mockResolvedValue({ id: "ing-1" });
    setIngredientActive.mockResolvedValue({ id: "ing-1", active: false });
  });

  test("renders ingredient list with result count", async () => {
    render(<IngredientMasterView branchId="khobar" />);
    await waitFor(() => {
      expect(screen.getByTestId("ingredient-result-count")).toHaveTextContent("1 ingredient");
    });
    expect(screen.getByText("Heavy cream")).toBeInTheDocument();
    expect(screen.queryByText("Tomato")).not.toBeInTheDocument();
  });

  test("filters by search and inactive status", async () => {
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.change(screen.getByTestId("ingredient-status-filter"), { target: { value: "inactive" } });
    expect(await screen.findByText("Tomato")).toBeInTheDocument();
    expect(screen.queryByText("Heavy cream")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("ingredient-search-input"), { target: { value: "tomato" } });
    expect(screen.getByTestId("ingredient-result-count")).toHaveTextContent("1 ingredient");
  });

  test("filters by category", async () => {
    fetchIngredients.mockResolvedValue(sampleIngredients);
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.change(screen.getByTestId("ingredient-status-filter"), { target: { value: "all" } });
    fireEvent.change(screen.getByTestId("ingredient-category-filter"), { target: { value: "Produce" } });
    expect(await screen.findByText("Tomato")).toBeInTheDocument();
    expect(screen.queryByText("Heavy cream")).not.toBeInTheDocument();
  });

  test("creates a valid ingredient", async () => {
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.click(screen.getByTestId("add-ingredient-button"));
    fireEvent.change(screen.getByTestId("ingredient-name-input"), { target: { value: "Whipping cream" } });
    fireEvent.change(screen.getByTestId("ingredient-category-input"), { target: { value: "Dairy" } });
    fireEvent.change(screen.getByTestId("ingredient-unit-select"), { target: { value: "litre" } });
    fireEvent.change(screen.getByTestId("ingredient-classification-select"), { target: { value: "beverage" } });
    fireEvent.click(screen.getByTestId("save-ingredient-button"));
    await waitFor(() => {
      expect(findDuplicateIngredient).toHaveBeenCalled();
      expect(createIngredient).toHaveBeenCalledWith(expect.objectContaining({
        canonicalName: "Whipping cream",
        category: "Dairy",
        baseInventoryUnit: "litre",
        inventoryClassification: "beverage",
        recipeCostEligible: true,
        branchId: "khobar",
      }));
    });
  });

  test("blocks duplicate ingredient names", async () => {
    findDuplicateIngredient.mockResolvedValue({ canonical_name: "Heavy cream" });
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.click(screen.getByTestId("add-ingredient-button"));
    fireEvent.change(screen.getByTestId("ingredient-name-input"), { target: { value: "Heavy cream" } });
    fireEvent.change(screen.getByTestId("ingredient-category-input"), { target: { value: "Dairy" } });
    fireEvent.click(screen.getByTestId("save-ingredient-button"));
    expect(await screen.findByTestId("ingredient-duplicate-warning")).toBeInTheDocument();
    expect(createIngredient).not.toHaveBeenCalled();
  });

  test("validates required fields before save", async () => {
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.click(screen.getByTestId("add-ingredient-button"));
    fireEvent.click(screen.getByTestId("save-ingredient-button"));
    expect(await screen.findByText("Ingredient name is required.")).toBeInTheDocument();
    expect(createIngredient).not.toHaveBeenCalled();
  });

  test("edits an ingredient and persists mapped fields", async () => {
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.click(screen.getByRole("button", { name: /Edit Heavy cream/i }));
    fireEvent.change(screen.getByTestId("ingredient-name-input"), { target: { value: "Heavy cream 35%" } });
    fireEvent.change(screen.getByTestId("ingredient-notes-input"), { target: { value: "Purchasing note" } });
    fireEvent.click(screen.getByTestId("save-ingredient-button"));
    await waitFor(() => {
      expect(updateIngredient).toHaveBeenCalledWith("ing-1", expect.objectContaining({
        canonicalName: "Heavy cream 35%",
        description: "Purchasing note",
      }));
    });
  });

  test("locks base unit when dependencies exist", async () => {
    fetchIngredientDependencySummary.mockResolvedValue({ hasDependencies: true, movementCount: 2, catalogueCount: 0, receiptCount: 0 });
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.click(screen.getByRole("button", { name: /Edit Heavy cream/i }));
    expect(await screen.findByTestId("ingredient-unit-lock-note")).toBeInTheDocument();
    expect(screen.getByTestId("ingredient-unit-select")).toBeDisabled();
  });

  test("deactivates an ingredient after confirmation", async () => {
    window.confirm = jest.fn(() => true);
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    fireEvent.click(screen.getByRole("button", { name: /Edit Heavy cream/i }));
    fireEvent.click(screen.getByTestId("deactivate-ingredient-button"));
    await waitFor(() => {
      expect(setIngredientActive).toHaveBeenCalledWith("ing-1", false);
    });
  });

  test("read-only users cannot edit ingredients", async () => {
    fetchInventoryStaffAccess.mockResolvedValue(readOnlyAccess);
    render(<IngredientMasterView branchId="khobar" />);
    await screen.findByText("Heavy cream");
    expect(screen.queryByTestId("add-ingredient-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Heavy cream/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("ingredient-result-count")).toHaveTextContent("Read-only access");
  });

  test("shows friendly API error handling", async () => {
    fetchIngredients.mockRejectedValueOnce(new Error("permission denied for table"));
    render(<IngredientMasterView branchId="khobar" />);
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});
