#!/usr/bin/env node
/**
 * Run focused Jest files. Usage:
 *   npm run verify:focused -- src/path/to.test.js
 * If no paths given, runs the NAC high-risk subset (verify:nac).
 */
import { spawnSync } from "child_process";

const extra = process.argv.slice(2);
const defaults = [
  "src/intelligence/askNac/coverage/temporalCoverage.test.js",
  "src/intelligence/askNac/vault/vaultPeriodCompare.test.js",
  "src/dashboard/MenuManager.production.test.js",
  "src/dashboard/health/dataIntegrityScan.test.js",
  "src/dashboard/health/recipeMappingClassification.test.js",
  "src/intelligence/askNac/shared/nacBusinessWeek.test.js",
  "src/dashboard/exportCenter/reportsReadiness.test.js",
];
const files = extra.length ? extra : defaults;
const result = spawnSync(
  "npx",
  ["react-scripts", "test", "--watchAll=false", ...files],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
