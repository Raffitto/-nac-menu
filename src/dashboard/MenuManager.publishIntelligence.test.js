import fs from "fs";
import path from "path";

const manager = fs.readFileSync(path.join(__dirname, "MenuManager.jsx"), "utf8");
const bar = fs.readFileSync(path.join(__dirname, "MenuPublishStatusBar.jsx"), "utf8");
const diff = fs.readFileSync(path.join(__dirname, "../lib/menuPublishDiff.js"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "../lib/menuApi.js"), "utf8");

describe("Menu Manager publish intelligence", () => {
  test("reuses publication ledger APIs instead of inventing parallel versioning", () => {
    expect(api).toContain("fetchLatestLivePublication");
    expect(api).toContain("listMenuPublications");
    expect(api).toContain("fetchCurrentBranchSnapshot");
    expect(api).toContain("restoreMenuPublication");
    expect(manager).toContain("useMenuPublishIntelligence");
    expect(manager).toContain("noteDraftChanged");
    expect(manager).not.toContain("draft_publications");
  });

  test("mutations save draft without auto-publish; manual publish opens diff", () => {
    expect(manager).toContain("noteDraftChanged");
    expect(manager).toContain("confirmPublishFromDiff");
    expect(manager).toContain("MenuPublishDiffSheet");
    expect(manager).toContain('action: "manual_publish"');
    const autoPublishCalls = (manager.match(/await publishCurrentMenu/g) || []).length;
    expect(autoPublishCalls).toBe(2); // confirm + retry only
  });

  test("changed indicators and preview/version UI are wired", () => {
    expect(manager).toContain("itemPublishBadge");
    expect(manager).toContain("mm-badge-publish");
    expect(manager).toContain("MenuPublishPreviewPanel");
    expect(manager).toContain("MenuVersionHistorySheet");
    expect(manager).toContain('label: "Preview Live Menu"');
    expect(manager).toContain('label: "Preview Draft Menu"');
    expect(manager).toContain('label: "View Menu Versions"');
  });

  test("restore is deferred in UI", () => {
    expect(manager).not.toContain("restoreMenuPublication(");
    const history = fs.readFileSync(
      path.join(__dirname, "menuPublish/MenuVersionHistorySheet.jsx"),
      "utf8",
    );
    expect(history).toContain("Version restore remains deferred");
  });

  test("status bar distinguishes waiting/publish/failed copy", () => {
    expect(bar).toContain("Changes waiting");
    expect(bar).toContain("Publish changes");
    expect(bar).toContain("Publish failed");
    expect(bar).toContain("Guest menu is up to date");
  });

  test("diff engine avoids raw sort_order dumps as primary UX", () => {
    expect(diff).toContain("Reordered");
    expect(diff).toContain("Position changed within");
    expect(diff).toContain("summarizeDiffForPublish");
  });

  test("natural interaction and sidebars remain present", () => {
    expect(manager).toContain("MenuCommandDock");
    expect(manager).toContain("MenuLassoLayer");
    expect(manager).toContain("MenuManagerDndProvider");
    expect(manager).not.toContain("arrange-mode-toggle");
  });
});
