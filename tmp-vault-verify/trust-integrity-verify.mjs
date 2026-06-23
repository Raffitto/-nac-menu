/**
 * Trust & integrity verification — Ask NAC semantics, coverage, dashboard math.
 *
 * Runs focused Jest suites (no production secrets required):
 *   node tmp-vault-verify/trust-integrity-verify.mjs
 *
 * Optional production probes: use cash-up-period-prod-verify.mjs with ASK_NAC_ACCESS_TOKEN.
 * Dashboard funnel sanity: operationalMetricsIntegrity.test.js (included below).
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const JEST_TARGETS = [
  "src/intelligence/askNac/nlu/businessSemantics.test.js",
  "src/intelligence/askNac/coverage/coverageAwareness.test.js",
  "src/intelligence/askNac/confidence/analyticalConfidence.test.js",
  "src/lib/operationalDashboardEnrich.test.js",
  "src/lib/operationalMetricsIntegrity.test.js",
  "src/intelligence/askNac/vault/vaultFlexiblePeriod.test.js",
];

console.log("Running trust & integrity Jest suites...\n");

try {
  execSync(
    `npm test -- --watchAll=false ${JEST_TARGETS.join(" ")}`,
    { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, CI: "true" } },
  );
  console.log("\n✓ All trust & integrity checks passed");
  process.exit(0);
} catch {
  console.error("\n✗ Trust & integrity checks failed");
  process.exit(1);
}
