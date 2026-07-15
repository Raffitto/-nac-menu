import fs from "fs";
import path from "path";

const dashboardDir = path.resolve(__dirname);
const componentSource = fs.readFileSync(
  path.join(dashboardDir, "MenuManager.jsx"),
  "utf8",
);
const cssSource = fs.readFileSync(
  path.join(dashboardDir, "styles/menu-manager.css"),
  "utf8",
);

describe("MenuManager production layout and loading contract", () => {
  test("publish metadata sits above a dedicated editor body", () => {
    expect(componentSource).toContain('className="mm-branch-bar"');
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

  test("additional placements remain dynamic, category-scoped, and editable in place", () => {
    expect(componentSource).toContain(
      "sectionsForCategory(placement.category_id)",
    );
    expect(componentSource).toContain("newPlacementRowKey()");
    expect(componentSource).toContain("disabled={!placement.category_id}");
    expect(componentSource).toContain(
      "removeExtraPlacement(index)",
    );
    expect(componentSource).toContain(
      "validatePlacements(\n        primaryPlacement,\n        extraPlacements,\n        sectionsCatalog,",
    );
  });
});
