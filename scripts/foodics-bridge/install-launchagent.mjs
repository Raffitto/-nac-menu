#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  createNodeFileSystem,
  defaultDataDir,
  invokeFabric,
  loadBridgeEnv,
  root,
} from "./lib.mjs";

loadBridgeEnv();

const home = os.homedir();
const dataDir = process.env.FOODICS_BRIDGE_DATA_DIR || defaultDataDir();
const nodeFs = createNodeFileSystem();
const plan = invokeFabric(`
  return mod.installPlan({
    repoRoot: ${JSON.stringify(root)},
    home: ${JSON.stringify(home)},
    nodePath: ${JSON.stringify(process.execPath)},
    dataDir: ${JSON.stringify(dataDir)},
  });
`);

for (const dir of [plan.paths.dataDir, plan.paths.logsDir, plan.paths.proofsDir]) {
  nodeFs.mkdir(dir);
}

const plistDir = path.dirname(plan.paths.launchAgentPlist);
nodeFs.mkdir(plistDir);
fs.writeFileSync(plan.paths.launchAgentPlist, plan.plist, "utf8");

if (process.platform === "darwin") {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, plan.paths.launchAgentPlist], { stdio: "ignore" });
  } catch {
    // agent may not be loaded yet
  }
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plan.paths.launchAgentPlist]);
  execFileSync("launchctl", ["enable", `gui/${process.getuid()}/${plan.scheduler.label}`]);
} else {
  console.error("launchctl install skipped: macOS only");
}

console.log(JSON.stringify({
  ok: true,
  label: plan.scheduler.label,
  schedule: `${String(plan.scheduler.hour).padStart(2, "0")}:${String(plan.scheduler.minute).padStart(2, "0")} ${plan.scheduler.timezone}`,
  command: plan.command,
  plistPath: plan.paths.launchAgentPlist,
  logsDir: plan.paths.logsDir,
  proofsDir: plan.paths.proofsDir,
  dataDir: plan.paths.dataDir,
}, null, 2));
