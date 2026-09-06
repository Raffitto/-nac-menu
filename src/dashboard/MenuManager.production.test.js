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
    expect(componentSource).toContain("mm-body");
    expect(componentSource).toMatch(/className=\{`mm-body \$\{menuSidebarCollapsed/);
    expect(cssSource).toMatch(/\.mm\s*\{[^}]*flex-direction:\s*column/s);
    expect(cssSource).toMatch(/\.mm-body\s*\{[^}]*display:\s*flex/s);
    expect(cssSource).toMatch(/\.mm-main\s*\{[^}]*min-width:\s*0/s);
  });

  test("initial category and item query failures cannot leave a silent blank editor", () => {
    expect(componentSource).toContain("await loadMenuForCategory(firstCategoryId)");
    expect(componentSource).toContain("if (itemErr) throw itemErr");
    expect(componentSource).toContain("MENU_CATALOGUE_SELECT");
    expect(componentSource).toMatch(/\.select\(MENU_CATALOGUE_SELECT\)/);
    const catalogueSelect = componentSource.match(/const MENU_CATALOGUE_SELECT = \[([\s\S]*?)\]\.join/);
    expect(catalogueSelect).toBeTruthy();
    expect(catalogueSelect[1]).not.toMatch(/\bsku\b/);
    expect(catalogueSelect[1]).toMatch(/name_en/);
    const catalogueColumns = catalogueSelect[1]
      .split(",")
      .map((part) => part.replace(/["'\s]/g, ""))
      .filter(Boolean);
    const allowedCatalogueColumns = [
      "id",
      "name_en",
      "name_ar",
      "price",
      "calories",
      "image",
      "active",
      "section_id",
      "sort_order",
      "sold_out",
      "featured",
      "new_item",
      "vegetarian",
      "vegan",
      "hidden_until",
      "placement_group_id",
    ];
    expect(catalogueColumns).toEqual(allowedCatalogueColumns);
    expect(catalogueColumns).not.toContain("desc_en");
    expect(catalogueColumns).not.toContain("desc_ar");
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

  test("guest highlight toggle reuses featured field", () => {
    expect(componentSource).toContain("Highlight on Guest Menu");
    expect(componentSource).toContain("featured: Boolean(editingItem.featured)");
    expect(componentSource).toContain('className="mm-badge mm-badge-featured">Highlighted</span>');
  });

  test("section add-item flow uses destination-first modal and placement API", () => {
    expect(componentSource).toContain('import MenuAddItemModal from "./MenuAddItemModal"');
    expect(componentSource).toContain("openAddItemChooser(section)");
    expect(componentSource).toContain("addExistingItemsToSection");
    expect(componentSource).toContain("buildMenuItemCatalogue");
    expect(componentSource).toContain("noteDraftChanged");
    expect(componentSource).toContain("onChooseCreateNew={() =>");
    expect(componentSource).toContain("<MenuItemPlacementEditor");
  });

  test("placing catalogue items saves draft and refreshes publish intelligence", () => {
    expect(componentSource).toContain("noteDraftChanged");
    expect(componentSource).toContain("addExistingItemsToSection");
    expect(componentSource).toContain("They remain hidden until activated.");
  });
});
