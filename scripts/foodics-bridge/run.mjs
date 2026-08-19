#!/usr/bin/env node
/**
 * Nightly / login-catch-up entrypoint for the authenticated Foodics bridge.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createNodeFileSystem,
  defaultDataDir,
  invokeFabric,
  loadBridgeEnv,
  parseArgs,
  root,
  upsertCanonicalBundle,
} from "./lib.mjs";

loadBridgeEnv();

const args = parseArgs(process.argv);
const home = os.homedir();
const dataDir = defaultDataDir();
const branchId = args.branch;
const asOf = new Date().toISOString();
const url = process.env.FOODICS_BRIDGE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const nodeFs = createNodeFileSystem();

const paths = invokeFabric(`
  return mod.resolveBridgePaths(${JSON.stringify(home)}, ${JSON.stringify(dataDir)});
`);

const seedFiles = {};
for (const filePath of [paths.stateFile, paths.lastRunFile]) {
  if (nodeFs.exists(filePath)) seedFiles[filePath] = nodeFs.read(filePath);
}
for (const dir of [paths.logsDir, `${paths.dataDir}/evidence`, `${paths.dataDir}/runs`]) {
  if (nodeFs.exists(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      seedFiles[filePath] = nodeFs.read(filePath);
    }
  }
}

const useLiveSource = Boolean(process.env.FOODICS_SESSION_COOKIE || process.env.FOODICS_CONSOLE_COOKIE
  || process.env.FOODICS_AUTH_TOKEN || process.env.FOODICS_AUTH_HEADERS_JSON) && !args.dryRun;

const output = invokeFabric(`
  const memFs = mod.createMemoryFileSystem(${JSON.stringify(seedFiles)});
  const store = mod.createLocalAcquisitionStore({
    paths: ${JSON.stringify(paths)},
    branchId: ${JSON.stringify(branchId)},
    fs: memFs,
  });
  const loaded = store.load();
  const source = ${useLiveSource}
    ? mod.foodicsConsoleSourceFromEnv(process.env)
    : mod.createScriptedFoodicsSource({ ordersByDate: {} });
  const bridge = await mod.runAuthenticatedFoodicsBridge({
    branchId: ${JSON.stringify(branchId)},
    asOf: ${JSON.stringify(asOf)},
    source,
    store,
    requestedSource: ${JSON.stringify(args.source)},
  });
  const proofPaths = [];
  const publishBundles = [];
  for (const row of bridge.results) {
    const artifactPath = store.writeProofArtifact(row.evidence, {
      trigger: bridge.plan.invocationSource === "catch-up" ? "catch-up" : ${JSON.stringify(args.source)},
      command: mod.buildSchedulerCommand({ repoRoot: ${JSON.stringify(root)}, invocationSource: ${JSON.stringify(args.source)} }),
      repoRoot: ${JSON.stringify(root)},
    });
    proofPaths.push(artifactPath);
    if (row.run.state === "PUBLISHED") {
      const bundle = store.getCanonical(${JSON.stringify(branchId)}, row.run.businessDate);
      if (bundle) publishBundles.push({ businessDate: row.run.businessDate, bundle });
    }
  }
  store.recordRunSummary({
    asOf: ${JSON.stringify(asOf)},
    requestedSource: ${JSON.stringify(args.source)},
    invocationSource: bridge.plan.invocationSource,
    publishedDates: bridge.publishedDates,
    watermark: bridge.watermark,
    failedDates: bridge.failedDates,
    states: bridge.results.map((row) => ({ date: row.run.businessDate, state: row.run.state })),
    proofPaths,
    liveSource: ${useLiveSource},
  });
  return {
    command: mod.buildSchedulerCommand({ repoRoot: ${JSON.stringify(root)}, invocationSource: ${JSON.stringify(args.source)} }),
    scheduler: mod.bridgeSchedulerSpec(),
    bridge,
    proofPaths,
    publishBundles,
    files: memFs.dump(),
    snapshot: store.snapshot(),
    sessionReady: mod.foodicsSessionReadyFromEnv(process.env),
    envReady: Boolean(process.env.FOODICS_BRIDGE_SUPABASE_URL || process.env.SUPABASE_URL)
      && Boolean(process.env.FOODICS_BRIDGE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
`);

for (const [filePath, content] of Object.entries(output.files || {})) {
  nodeFs.write(filePath, content);
}
nodeFs.mkdir(paths.logsDir);
nodeFs.mkdir(paths.proofsDir);

if (!args.dryRun && url && key) {
  for (const row of output.publishBundles || []) {
    await upsertCanonicalBundle({
      url,
      key,
      branchId,
      businessDate: row.businessDate,
      bundle: row.bundle,
    });
  }
}

const exitCode = (output.bridge?.failedDates || []).length ? 1 : 0;
console.log(JSON.stringify({
  ok: exitCode === 0,
  entrypoint: "scripts/foodics-bridge/run.mjs",
  command: output.command,
  scheduler: output.scheduler,
  plan: output.bridge?.plan,
  publishedDates: output.bridge?.publishedDates,
  watermark: output.bridge?.watermark,
  failedDates: output.bridge?.failedDates,
  invocationSource: output.bridge?.plan?.invocationSource,
  proofPaths: output.proofPaths,
  sessionReady: output.sessionReady,
  envReady: output.envReady,
  liveSource: useLiveSource,
}, null, 2));
process.exit(exitCode);
