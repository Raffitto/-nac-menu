import fs from "fs";
import path from "path";

const dashboardDir = path.resolve(__dirname);
const componentSource = fs.readFileSync(
  path.join(dashboardDir, "MenuManager.jsx"),
  "utf8",
);
const placementEditorSource = fs.readFileSync(
  path.join(dashboardDir, "MenuItemPlacementEditor.jsx"),
  "utf8",
);
const cssSource = fs.readFileSync(
  path.join(dashboardDir, "styles/menu-manager.css"),
  "utf8",
);

describe("MenuManager production layout and loading contract", () => {
  test("publish metadata sits above a dedicated editor body", () => {
    expect(componentSource).toContain('className="mm-top-shell"');
    expect(componentSource).toContain("MenuPublishStatusBar");
    expect(componentSource).toContain('className="mm-body"');
    expect(cssSource).toMatch(/\.mm\s*\{[^}]*flex-direction:\s*column/s);
    expect(cssSource).toMatch(/\.mm-body\s*\{[^}]*display:\s*flex/s);
    expect(cssSource).toMatch(/\.mm-main\s*\{[^}]*min-width:\s*0/s);
  });

  test("initial category and item query failures cannot leave a silent blank editor", () => {
    expect(componentSource).toContain("await loadMenuForCategory(firstCategoryId)");
    expect(componentSource).toContain("if (itemErr) throw itemErr");
    expect(componentSource).toContain("menuLoadRequestRef");
  });

  test("menu manager delegates placement editing to the chip-based editor", () => {
    expect(componentSource).toContain('import MenuItemPlacementEditor from "./MenuItemPlacementEditor"');
    expect(componentSource).toContain("<MenuItemPlacementEditor");
    expect(componentSource).toContain("buildExtraPlacementsFromMembers");
    expect(componentSource).toContain("hydratePlacementCategoryIds");
    expect(componentSource).toContain("reorderPlacementRows");
    expect(componentSource).toContain(
      "validatePlacements(\n        primaryPlacement,\n        extraPlacements,\n        sectionsCatalog,",
    );
    expect(componentSource).not.toContain("mm-placement-extra-row");
  });

  test("placement editor uses chip cards with inline add and edit pickers", () => {
    expect(placementEditorSource).toContain('data-testid="primary-placement-chip"');
    expect(placementEditorSource).toContain('data-testid="add-placement-button"');
    expect(placementEditorSource).toContain("PlacementPicker");
    expect(placementEditorSource).toContain("onMoveExtraPlacement");
    expect(cssSource).toMatch(/\.mm-placement-chip\s*\{/);
    expect(cssSource).toMatch(/\.mm-placement-picker\s*\{/);
  });

  test("save path preserves existing placement API and publish workflow", () => {
    expect(componentSource).toContain("createMenuItemPlacements({");
    expect(componentSource).toContain("updateMenuItemPlacements({");
    expect(componentSource).toContain("publishCurrentMenu(");
    expect(componentSource).toContain("removePlacementItemIds: removedPlacementIds");
    expect(componentSource).toContain("extraSectionIds");
  });

  test("backward compatibility normalizes linked members without category ids", () => {
    expect(componentSource).toContain(
      "hydratePlacementCategoryIds(\n        buildExtraPlacementsFromMembers(",
    );
    expect(placementEditorSource).toContain("collectUsedPlacementKeys");
  });

  test("guest highlight toggle reuses featured field and verifies publish payload", () => {
    expect(componentSource).toContain("Highlight on Guest Menu");
    expect(componentSource).toContain("featured: contentPayload.featured");
    expect(componentSource).toContain('className="mm-badge mm-badge-featured">Highlighted</span>');
  });

  test("section add-item flow uses destination-first modal and placement API", () => {
    expect(componentSource).toContain('import MenuAddItemModal from "./MenuAddItemModal"');
    expect(componentSource).toContain("openAddItemChooser(section)");
    expect(componentSource).toContain("addExistingItemsToSection");
    expect(componentSource).toContain("buildMenuItemCatalogue");
    expect(componentSource).toContain('action: "add_placement"');
    expect(componentSource).toContain("onChooseCreateNew={() =>");
    expect(componentSource).toContain("<MenuItemPlacementEditor");
  });
});
