#!/usr/bin/env node
/**
 * Deterministic LaunchAgent install/update. Repeatable and non-destructive.
 * On non-darwin hosts this writes/validates artifacts only and does not claim Mac execution.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AFTER_ENTRYPOINT, BEFORE_ENTRYPOINT, DEFAULT_BRANCH } from "./constants.mjs";
import { applyLaunchAgentInstall, planLaunchAgentInstall, resolveNodePath } from "./launchdWiring.mjs";

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  return hit.slice(name.length + 3);
}

const repoRoot = path.resolve(arg("repo") || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const dryRun = Boolean(arg("dry-run"));
const plan = planLaunchAgentInstall({
  repoRoot,
  bridgeHome: arg("bridge-home") || process.env.FOODICS_BRIDGE_HOME,
  stateRoot: arg("state-root") || process.env.NAC_FOODICS_STATE_ROOT,
  launchAgentsDir: arg("launch-agents-dir") || process.env.NAC_FOODICS_LAUNCH_AGENTS_DIR,
  branchId: arg("branch", process.env.NAC_FOODICS_BRANCH || DEFAULT_BRANCH),
  nodePath: arg("node") || resolveNodePath(process.env),
  dryRun,
  platform: arg("platform") || process.platform,
  launchctlAvailable: arg("skip-launchctl") ? false : process.platform === "darwin",
  uid: process.getuid?.(),
  env: process.env,
  homedir: os.homedir(),
  fs,
});

if (!fs.existsSync(plan.paths.entrypointPath)) {
  process.stderr.write(`entrypoint missing: ${plan.paths.entrypointPath}\n`);
  process.exit(2);
}

const result = applyLaunchAgentInstall(plan, { fs, execFileSync });
const report = {
  ok: result.ok,
  abort: result.abort || null,
  beforeEntrypoint: BEFORE_ENTRYPOINT,
  afterEntrypoint: AFTER_ENTRYPOINT,
  label: plan.label,
  schedule: plan.schedule,
  command: plan.command,
  wrotePlist: result.wrotePlist,
  unchanged: result.unchanged,
  backedUp: result.backedUp || false,
  reloaded: result.reloaded,
  launchctlError: result.launchctlError || null,
  macExecutionRequired: result.macExecutionRequired,
  macExecutionClaimed: false,
  dryRun: result.dryRun,
  paths: {
    plist: plan.paths.plistPath,
    entrypoint: plan.paths.entrypointPath,
    proof: plan.paths.lastProofPath,
    logs: plan.paths.logsDir,
    stateRoot: plan.paths.stateRoot,
    bridgeHome: plan.paths.bridgeHome,
  },
  oneStepCommand: `node ${AFTER_ENTRYPOINT}`,
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (!result.ok) process.exit(2);
