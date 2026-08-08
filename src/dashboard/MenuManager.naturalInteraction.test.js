import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const manager = fs.readFileSync(path.join(__dirname, "MenuManager.jsx"), "utf8");
const dnd = fs.readFileSync(path.join(__dirname, "MenuManagerDnd.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles/menu-manager.css"), "utf8");

describe("Menu Manager natural interaction system", () => {
  test("keeps dnd-kit foundations with always-on direct manipulation", () => {
    expect(dnd).toContain("@dnd-kit/core");
    expect(dnd).toContain("activationConstraint: { distance: fluid ? 4 : 8 }");
    expect(dnd).toContain("delay: fluid ? 180 : 280");
    expect(dnd).toContain("activeDragCount");
    expect(dnd).toContain("is-selected");
    expect(manager).toContain("moveSelectedGroup");
    expect(manager).toContain("getDragGroupIds");
    expect(manager).toContain("persistBoardTransition");
    expect(manager).not.toContain("arrangeMode");
    expect(manager).not.toContain("arrange-mode-toggle");
    expect(manager).not.toContain("setArrangeMode");
  });

  test("wires selection, undo, context menu, palette, quick look, lasso, command dock", () => {
    expect(manager).toContain('from "./menuInteraction/useMenuSelection"');
    expect(manager).toContain('from "./menuInteraction/useMenuUndo"');
    expect(manager).toContain("MenuCommandDock");
    expect(manager).toContain("MenuContextMenu");
    expect(manager).toContain("MenuCommandPalette");
    expect(manager).toContain("MenuQuickLook");
    expect(manager).toContain("MenuLassoLayer");
    expect(manager).toContain('event.key === " "');
    expect(manager).toContain('event.key.toLowerCase() === "k"');
    expect(manager).toContain("undoApi.undo");
    expect(manager).toContain("Select Similar → Same section");
    expect(manager).not.toContain('label: "Arrange menu"');
  });

  test("preserves seasonal safety and does not invent trash/history schema", () => {
    expect(manager).not.toContain("localStorage.setItem(\"nac_menu_trash\"");
    expect(manager).not.toContain("fakeHistory");
    expect(fs.existsSync(path.join(root, "lib/menuInteraction/selectionModel.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, "lib/menuInteraction/groupOrdering.js"))).toBe(true);
    expect(css).toContain(".mm-command-dock");
    expect(css).toContain(".mm-item-card.is-selected");
  });

  test("interaction actions remain publish-backed", () => {
    expect(manager).toContain('action: "bulk_visibility"');
    expect(manager).toContain('action: "bulk_sold_out"');
    expect(manager).toContain("publishCurrentMenu");
    expect(manager).toContain("pushUndo");
  });
});
