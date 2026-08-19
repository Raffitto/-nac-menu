#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import {
  createNodeFileSystem,
  defaultDataDir,
  invokeFabric,
  launchAgentLoaded,
  loadBridgeEnv,
  root,
} from "./lib.mjs";

loadBridgeEnv();

const home = os.homedir();
const dataDir = defaultDataDir();
const branchId = process.env.FOODICS_BRIDGE_BRANCH_ID || "khobar";
const nodeFs = createNodeFileSystem();
const paths = invokeFabric(`return mod.resolveBridgePaths(${JSON.stringify(home)}, ${JSON.stringify(dataDir)});`);
const scheduler = invokeFabric("return mod.bridgeSchedulerSpec();");

let state = null;
let lastRun = null;
let lastProof = null;
if (nodeFs.exists(paths.stateFile)) {
  state = JSON.parse(nodeFs.read(paths.stateFile));
}
if (nodeFs.exists(paths.lastRunFile)) {
  lastRun = JSON.parse(nodeFs.read(paths.lastRunFile));
}
if (state?.lastProofRunId && nodeFs.exists(`${paths.dataDir}/evidence/${state.lastProofRunId}.json`)) {
  lastProof = JSON.parse(nodeFs.read(`${paths.dataDir}/evidence/${state.lastProofRunId}.json`));
}

let installedCommand = null;
if (fs.existsSync(paths.launchAgentPlist)) {
  const plist = fs.readFileSync(paths.launchAgentPlist, "utf8");
  const args = invokeFabric(`return mod.parseLaunchAgentProgramArguments(${JSON.stringify(plist)});`);
  installedCommand = args ? args.join(" ") : null;
}

const loaded = launchAgentLoaded(scheduler.label);
const report = invokeFabric(`
  return mod.buildBridgeStatusReport({
    paths: ${JSON.stringify(paths)},
    scheduler: ${JSON.stringify(scheduler)},
    branchId: ${JSON.stringify(branchId)},
    launchAgentLoaded: ${loaded === null ? "null" : String(loaded)},
    installedCommand: ${JSON.stringify(installedCommand)},
    state: ${JSON.stringify({
      watermark: state?.watermark ?? null,
      publishedDates: state?.publishedDates ?? [],
      proofState: state?.proofState ?? null,
      lastRun,
      lastProof,
    })},
    sessionReady: mod.foodicsSessionReadyFromEnv(process.env),
    envReady: Boolean(process.env.FOODICS_BRIDGE_SUPABASE_URL || process.env.SUPABASE_URL)
      && Boolean(process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
`);

console.log(JSON.stringify(report, null, 2));
