import {
  SIDEBAR_KEYS,
  defaultCollapsedForViewport,
  readSidebarCollapsed,
  toggleSidebarCollapsed,
  writeSidebarCollapsed,
} from "./sidebarPrefs";

describe("sidebarPrefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("reads and writes independent versioned keys", () => {
    expect(readSidebarCollapsed(SIDEBAR_KEYS.global, false)).toBe(false);
    writeSidebarCollapsed(SIDEBAR_KEYS.global, true);
    writeSidebarCollapsed(SIDEBAR_KEYS.menu, false);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.global, false)).toBe(true);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.menu, true)).toBe(false);
  });

  test("toggle flips persisted value", () => {
    expect(toggleSidebarCollapsed(SIDEBAR_KEYS.menu, false)).toBe(true);
    expect(readSidebarCollapsed(SIDEBAR_KEYS.menu, false)).toBe(true);
    expect(toggleSidebarCollapsed(SIDEBAR_KEYS.menu, false)).toBe(false);
  });

  test("viewport helper is boolean", () => {
    expect(typeof defaultCollapsedForViewport()).toBe("boolean");
  });
});
