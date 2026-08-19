#!/usr/bin/env node
/**
 * Read-only Foodics bridge diagnostics. Never fabricates missing local runtime.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BRANCH } from "./constants.mjs";
import { collectFoodicsBridgeStatus, resolveBridgePaths } from "./launchdWiring.mjs";
import { loadEnvFile } from "./localSource.mjs";
import { engineCalendar, enginePlan } from "./engineBridge.mjs";

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  return hit.slice(name.length + 3);
}

const repoRoot = path.resolve(arg("repo") || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const paths = resolveBridgePaths({
  repoRoot,
  bridgeHome: arg("bridge-home") || process.env.FOODICS_BRIDGE_HOME,
  stateRoot: arg("state-root") || process.env.NAC_FOODICS_STATE_ROOT,
  launchAgentsDir: arg("launch-agents-dir") || process.env.NAC_FOODICS_LAUNCH_AGENTS_DIR,
  env: process.env,
  homedir: os.homedir(),
});
loadEnvFile(path.join(paths.bridgeHome, ".env.local"), process.env);

const asOf = arg("as-of", new Date().toISOString());
const branchId = arg("branch", process.env.NAC_FOODICS_BRANCH || DEFAULT_BRANCH);

let launchctlListOutput = null;
if (process.platform === "darwin" && !arg("skip-launchctl")) {
  try {
    launchctlListOutput = execFileSync("launchctl", ["list"], { encoding: "utf8" });
  } catch {
    launchctlListOutput = null;
  }
}

let nextMissing = null;
let calendar = null;
try {
  calendar = engineCalendar(asOf);
  const published = (() => {
    const last = paths.lastProofPath && fs.existsSync(path.join(paths.stateRoot, "published.json"))
      ? JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "published.json"), "utf8"))
      : {};
    return Object.keys(last)
      .filter((k) => k.startsWith(`${branchId}:`))
      .map((k) => k.slice(branchId.length + 1));
  })();
  const watermarkDoc = fs.existsSync(paths.watermarkPath)
    ? JSON.parse(fs.readFileSync(paths.watermarkPath, "utf8"))
    : null;
  const plan = enginePlan({
    asOf,
    publishedDates: published,
    watermark: watermarkDoc?.watermark?.[branchId] || null,
  });
  nextMissing = plan.datesOldestFirst[0] || null;
} catch {
  nextMissing = null;
}

const status = collectFoodicsBridgeStatus({
  repoRoot,
  stateRoot: paths.stateRoot,
  bridgeHome: paths.bridgeHome,
  launchAgentsDir: paths.launchAgentsDir,
  env: process.env,
  homedir: os.homedir(),
  fs,
  platform: process.platform,
  launchctlListOutput,
  nextMissingCompletedDate: nextMissing,
  branchId,
});
status.calendar = calendar;
status.oneStepInstall = `node scripts/foodics-bridge/install-launchagent.mjs`;
status.oneStepStatus = `node scripts/foodics-bridge/status.mjs`;
status.oneStepRun = `node scripts/foodics-bridge/run-nightly.mjs`;

if (arg("pretty") !== "false") {
  process.stdout.write(JSON.stringify(status, null, 2) + "\n");
} else {
  process.stdout.write(JSON.stringify(status) + "\n");
}
