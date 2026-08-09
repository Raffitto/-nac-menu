import fs from "fs";
import path from "path";

const adminPath = path.join(__dirname, "AdminDashboard.jsx");
const indexPath = path.join(__dirname, "..", "index.js");
const opsPath = path.join(__dirname, "views", "OperationalDashboard.jsx");
const adminSrc = fs.readFileSync(adminPath, "utf8");
const indexSrc = fs.readFileSync(indexPath, "utf8");
const opsSrc = fs.readFileSync(opsPath, "utf8");

describe("AdminDashboard cold-boot contracts", () => {
  test("does not statically import recharts or OperationalDashboard", () => {
    expect(adminSrc).not.toMatch(/from\s+["']recharts["']/);
    expect(adminSrc).not.toMatch(/import OperationalDashboard from/);
    expect(adminSrc).toContain('lazy(() => import("./views/OperationalDashboard"))');
    expect(adminSrc).toContain('lazy(() => import("./views/LegacyOverviewPanel"))');
  });

  test("defers heavy hub prefetch until after Tier-1 data", () => {
    expect(adminSrc).toContain("Prefetch AFTER Overview Tier-1");
    expect(adminSrc).toContain('schedule("intelligence", 8000)');
    expect(adminSrc).toContain('schedule("menu", 12000)');
    // Must not fire all hubs at 40ms on idle as before.
    expect(adminSrc).not.toMatch(/schedulePrefetch\(id, fn, 40\)/);
  });

  test("shows boot shell while session restores", () => {
    expect(adminSrc).toContain("AdminBootShell");
    expect(adminSrc).toContain("Restoring your session");
    expect(indexSrc).toContain("Loading workspace");
  });

  test("OperationalDashboard lazy-loads recharts hourly chart", () => {
    expect(opsSrc).not.toMatch(/from\s+["']recharts["']/);
    expect(opsSrc).toContain('lazy(() => import("../components/HourlyScanChart"))');
    expect(opsSrc).toContain("tier2Ready");
  });

  test("keep-alive navigation helpers remain", () => {
    expect(adminSrc).toContain("useKeepAliveNav");
    expect(adminSrc).toContain("admin-keepalive-pane");
  });
});
