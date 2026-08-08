import fs from "fs";
import path from "path";
import {
  SIDEBAR_EVENTS,
  SIDEBAR_KEYS,
  emitSidebarToggle,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "../lib/sidebarPrefs";
import { notifyLayoutResize } from "../lib/sidebarPrefs";

const manager = fs.readFileSync(path.join(__dirname, "MenuManager.jsx"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "AdminDashboard.jsx"), "utf8");
const mmCss = fs.readFileSync(path.join(__dirname, "styles/menu-manager.css"), "utf8");
const adminCss = fs.readFileSync(path.join(__dirname, "styles/admin-dashboard.css"), "utf8");
const dnd = fs.readFileSync(path.join(__dirname, "MenuManagerDnd.jsx"), "utf8");

describe("Collapsible sidebars", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("persists independent global and menu collapse states", () => {
    writeSidebarCollapsed(SIDEBAR_KEYS.global, true);
    writeSidebarCollapsed(SIDEBAR_KEYS.menu, false);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.global, false)).toBe(true);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.menu, true)).toBe(false);

    writeSidebarCollapsed(SIDEBAR_KEYS.global, false);
    writeSidebarCollapsed(SIDEBAR_KEYS.menu, true);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.global, true)).toBe(false);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.menu, false)).toBe(true);
  });

  test("supports all four independent combinations", () => {
    const combos = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];
    combos.forEach(([global, menu]) => {
      writeSidebarCollapsed(SIDEBAR_KEYS.global, global);
      writeSidebarCollapsed(SIDEBAR_KEYS.menu, menu);
      expect(readSidebarCollapsed(SIDEBAR_KEYS.global, !global)).toBe(global);
      expect(readSidebarCollapsed(SIDEBAR_KEYS.menu, !menu)).toBe(menu);
    });
  });

  test("uses versioned localStorage keys (not menu DB tables)", () => {
    expect(SIDEBAR_KEYS.global).toBe("nac.os.ui.sidebar.global.v1");
    expect(SIDEBAR_KEYS.menu).toBe("nac.os.ui.sidebar.menu.v1");
    expect(manager).not.toContain("from(\"sidebar_prefs\")");
    expect(manager).toContain("SIDEBAR_KEYS.menu");
    expect(manager).toContain('from "../lib/sidebarPrefs"');
  });

  test("wires global sidebar collapse controls and Cmd/Ctrl+B", () => {
    expect(admin).toContain("useCollapsibleSidebar");
    expect(admin).toContain('data-testid="global-app-sidebar"');
    expect(admin).toContain('data-testid="global-sidebar-toggle"');
    expect(admin).toContain('aria-label={globalSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}');
    expect(admin).toContain('event.key.toLowerCase() === "b" && !event.shiftKey');
    expect(adminCss).toContain(".admin-sidebar.is-collapsed");
    expect(adminCss).toContain("--admin-sidebar-width");
  });

  test("wires menu category sidebar collapse independently", () => {
    expect(manager).toContain("useCollapsibleSidebar");
    expect(manager).toContain("SIDEBAR_KEYS.menu");
    expect(manager).toContain('data-testid="menu-category-sidebar"');
    expect(manager).toContain('data-testid="menu-sidebar-toggle"');
    expect(manager).toContain('aria-label={menuSidebarCollapsed ? "Expand menu categories" : "Collapse menu categories"}');
    expect(manager).toContain("menuSidebarCollapsed");
    expect(mmCss).toContain(".mm-sidebar.is-collapsed");
    expect(mmCss).toContain("--menu-sidebar-width");
    expect(mmCss).toContain("mm-body--menu-sidebar-collapsed");
  });

  test("keeps active nav and active category discoverable when collapsed", () => {
    expect(admin).toContain("aria-current={isActive ? \"page\" : undefined}");
    expect(admin).toContain("title={item.label}");
    expect(manager).toContain("mm-sidebar-rail");
    expect(manager).toContain("selectedCategory?.name_en");
    expect(manager).toContain("Expand categories — current:");
  });

  test("command palette includes sidebar view commands", () => {
    expect(manager).toContain('label: "Toggle Navigation Sidebar"');
    expect(manager).toContain('label: "Toggle Menu Sidebar"');
    expect(manager).toContain('label: "Expand Both Sidebars"');
    expect(manager).toContain('label: "Collapse Both Sidebars"');
    expect(manager).toContain('emitSidebarToggle("global")');
    expect(manager).toContain('emitSidebarToggle("menu")');
  });

  test("documents supported sidebar shortcuts", () => {
    expect(manager).toContain("Toggle navigation sidebar");
    expect(manager).toContain("Toggle menu sidebar");
    expect(manager).toContain('event.shiftKey && event.key.toLowerCase() === "b"');
  });

  test("DnD / lasso / arrange foundations remain wired", () => {
    expect(manager).toContain("MenuManagerDndProvider");
    expect(manager).toContain("MenuLassoLayer");
    expect(manager).toContain("MenuCommandDock");
    expect(manager).not.toContain("arrange-mode-toggle");
    expect(dnd).toContain("@dnd-kit/core");
    expect(admin).toContain("useCollapsibleSidebar");
  });

  test("layout resize notify is available for measurement refresh", () => {
    expect(typeof notifyLayoutResize).toBe("function");
    const hook = fs.readFileSync(
      path.join(__dirname, "hooks/useCollapsibleSidebar.js"),
      "utf8",
    );
    expect(hook).toContain("notifyLayoutResize");
    expect(hook).toContain("220");
  });

  test("emitSidebarToggle dispatches distinct events", () => {
    const seen = [];
    const onGlobal = () => seen.push("global");
    const onMenu = () => seen.push("menu");
    window.addEventListener(SIDEBAR_EVENTS.globalToggle, onGlobal);
    window.addEventListener(SIDEBAR_EVENTS.menuToggle, onMenu);
    emitSidebarToggle("global");
    emitSidebarToggle("menu");
    window.removeEventListener(SIDEBAR_EVENTS.globalToggle, onGlobal);
    window.removeEventListener(SIDEBAR_EVENTS.menuToggle, onMenu);
    expect(seen).toEqual(["global", "menu"]);
  });

  test("responsive CSS prefers drawer/reveal over cramped permanent rails", () => {
    expect(adminCss).toContain(".admin-sidebar.is-collapsed");
    expect(adminCss).toContain("admin-sidebar-mobile-reveal");
    expect(mmCss).toContain("mm-sidebar-mobile-reveal");
    expect(adminCss).toMatch(/@media \(max-width: 760px\)[\s\S]*\.admin-sidebar\.is-collapsed \{\s*display: none;/);
    expect(mmCss).toMatch(/@media \(max-width: 900px\)[\s\S]*\.mm-sidebar\.is-collapsed \{\s*display: none;/);
  });

  test("respects reduced motion for sidebar width transitions", () => {
    expect(adminCss).toContain("prefers-reduced-motion");
    expect(mmCss).toContain("prefers-reduced-motion");
  });
});
