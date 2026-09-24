/**
 * Architectural contract: inactive admin views must not stay mounted and keep fetching.
 */
import fs from "fs";
import path from "path";

const adminPath = path.join(__dirname, "AdminDashboard.jsx");
const navPath = path.join(__dirname, "hooks/useKeepAliveNav.js");
const biPath = path.join(__dirname, "../lib/intelligenceQueryApi.js");
const askEdgePath = path.join(
  __dirname,
  "../../supabase/functions/_shared/askNacMenuMetrics.ts",
);

const adminSrc = fs.readFileSync(adminPath, "utf8");
const navSrc = fs.readFileSync(navPath, "utf8");
const biSrc = fs.readFileSync(biPath, "utf8");
const askEdgeSrc = fs.readFileSync(askEdgePath, "utf8");

describe("NAC OS systemic performance contracts", () => {
  test("shell mounts only the active view", () => {
    expect(adminSrc).toContain('adminView === "overview"');
    expect(adminSrc).toContain('adminView === "intelligence"');
    expect(adminSrc).toContain("ActiveViewProvider");
    expect(adminSrc).not.toContain("admin-keepalive-pane");
    expect(adminSrc).not.toMatch(/hidden=\{adminView !==/);
  });

  test("nav hook is active-only (no accumulate-mounted set)", () => {
    expect(navSrc).toContain("active-only");
    expect(navSrc).not.toMatch(/new Set\(prev\)/);
  });

  test("Overview BI enables only while overview is active", () => {
    expect(adminSrc).toContain("overviewActive && unifiedOverview");
    expect(adminSrc).toContain("overviewActive && !unifiedOverview");
    expect(adminSrc).not.toMatch(/overviewMounted &&/);
  });

  test("interactive BI stays on rollup; client menu_events scans require forceLiveBi", () => {
    expect(biSrc).toContain('primaryRpc = "get_bi_dashboard_from_rollup"');
    expect(biSrc).toContain("forceLiveBi && !deferClientPatches");
    expect(biSrc).toContain("dedupeInflight");
  });

  test("Ask NAC Edge metrics never call raw get_bi_dashboard", () => {
    expect(askEdgeSrc).toContain('primaryRpc = "get_bi_dashboard_from_rollup"');
    expect(askEdgeSrc).not.toMatch(/rpcBiDashboard\(supabase,\s*"get_bi_dashboard"/);
  });
});
