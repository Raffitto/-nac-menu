import fs from "fs";
import path from "path";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import MenuCommandDock from "./menuInteraction/MenuCommandDock";
import { summarizeSelectionAggregates } from "../lib/menuInteraction/selectionAggregates";

const manager = fs.readFileSync(path.join(__dirname, "MenuManager.jsx"), "utf8");
const dnd = fs.readFileSync(path.join(__dirname, "MenuManagerDnd.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles/menu-manager.css"), "utf8");

describe("Menu Manager arrange removal + command dock", () => {
  test("Arrange button and palette entry are gone", () => {
    expect(manager).not.toContain("arrange-mode-toggle");
    expect(manager).not.toContain("arrange-done");
    expect(manager).not.toContain("Arrange mode");
    expect(manager).not.toContain('label: "Arrange menu"');
    expect(manager).not.toContain("Exit Arrange");
    expect(css).not.toContain("is-arrange-mode");
  });

  test("core interactions remain always available without Arrange", () => {
    expect(manager).toContain("MenuManagerDndProvider");
    expect(manager).toContain("MenuLassoLayer");
    expect(manager).toContain("handleItemPointerSelect");
    expect(manager).toContain("MenuContextMenu");
    expect(manager).toContain("openQuickLook");
    expect(manager).toContain("moveSelectedGroup");
    expect(dnd).toContain("useMenuManagerDndSensors");
    expect(dnd).toContain("fluid ? 4 : 8");
    expect(manager).toContain("fluidDnd");
    expect(manager).toContain("useCoarsePointer");
  });

  test("palette keeps useful selection/view commands", () => {
    expect(manager).toContain('label: "Select All Visible"');
    expect(manager).toContain('label: "Clear Selection"');
    expect(manager).toContain('label: "Move Selected To…"');
    expect(manager).toContain('label: "Collapse Both Sidebars"');
    expect(manager).toContain('label: "Expand Both Sidebars"');
  });

  test("dock hidden when not visible; shows count and primary Move", () => {
    const { rerender } = render(
      <MenuCommandDock count={0} visible={false} onClear={() => {}} />,
    );
    expect(screen.queryByTestId("menu-command-dock")).toBeNull();

    rerender(
      <MenuCommandDock
        count={1}
        visible={false}
        onClear={() => {}}
      />,
    );
    expect(screen.queryByTestId("menu-command-dock")).toBeNull();

    const onMove = jest.fn();
    const onClear = jest.fn();
    rerender(
      <MenuCommandDock
        count={3}
        visible
        visibilityMode="visible"
        visibilityLabel="Hide"
        soldOutMode="available"
        soldOutLabel="Sold Out"
        onClear={onClear}
        onMove={onMove}
        onVisibilityAction={() => {}}
        onSoldOutAction={() => {}}
        moreItems={[{ id: "shortcuts", label: "Keyboard Shortcuts", onSelect: () => {} }]}
      />,
    );
    expect(screen.getByTestId("menu-command-dock")).toBeInTheDocument();
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("command-dock-move"));
    expect(onMove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("command-dock-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("dynamic visibility and sold-out labels", () => {
    expect(summarizeSelectionAggregates([{ active: true }, { active: true }]).visibilityLabel).toBe("Hide");
    expect(summarizeSelectionAggregates([{ active: false }, { active: false }]).visibilityLabel).toBe("Show");
    expect(summarizeSelectionAggregates([{ active: true }, { active: false }]).visibilityLabel).toBe("Visibility…");
    expect(summarizeSelectionAggregates([{ sold_out: false }, { sold_out: false }]).soldOutLabel).toBe("Sold Out");
    expect(summarizeSelectionAggregates([{ sold_out: true }, { sold_out: true }]).soldOutLabel).toBe("Available");
    expect(summarizeSelectionAggregates([{ sold_out: true }, { sold_out: false }]).soldOutLabel).toBe("Status…");
  });

  test("mixed visibility opens submenu without inventing board writes", () => {
    const onHide = jest.fn();
    const onShow = jest.fn();
    render(
      <MenuCommandDock
        count={2}
        visible
        visibilityMode="mixed"
        visibilityLabel="Visibility…"
        soldOutMode="mixed"
        soldOutLabel="Status…"
        onClear={() => {}}
        onMove={() => {}}
        onHide={onHide}
        onShow={onShow}
        onSoldOut={() => {}}
        onMarkAvailable={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("command-dock-visibility"));
    expect(screen.getByTestId("command-dock-visibility-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onShow).not.toHaveBeenCalled();
  });

  test("More menu exposes overflow actions", () => {
    const onShortcuts = jest.fn();
    render(
      <MenuCommandDock
        count={2}
        visible
        onClear={() => {}}
        moreItems={[
          { id: "quicklook", label: "Quick Look", onSelect: () => {} },
          { id: "shortcuts", label: "Keyboard Shortcuts", onSelect: onShortcuts },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("command-dock-more"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Keyboard Shortcuts" }));
    expect(onShortcuts).toHaveBeenCalledTimes(1);
  });

  test("shared hide/show/sold-out handlers wire dock and context menu", () => {
    expect(manager).toContain("hideSelected");
    expect(manager).toContain("showSelected");
    expect(manager).toContain("markSelectedSoldOut");
    expect(manager).toContain("markSelectedAvailable");
    expect(manager).toContain("onSelect: hideSelected");
    expect(manager).toContain("onHide={hideSelected}");
  });

  test("toast and board padding coordinate with dock", () => {
    expect(css).toContain(".mm.has-command-dock .mm-toast");
    expect(css).toContain(".mm-content.has-command-dock");
    expect(css).toContain("safe-area-inset-bottom");
    expect(manager).toContain("has-command-dock");
  });

  test("dock is not a DnD drop surface and lasso ignores it", () => {
    const lasso = fs.readFileSync(
      path.join(__dirname, "menuInteraction/MenuLassoLayer.jsx"),
      "utf8",
    );
    expect(lasso).toContain(".mm-command-dock");
    expect(dnd).not.toContain("command-dock");
  });
});
