#!/usr/bin/env node
/**
 * LaunchAgent / CLI entrypoint. Calls runAuthenticatedFoodicsBridge.
 * Does not claim Mac execution when run in cloud CI.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_BRANCH, HARDENED_BRIDGE_FN } from "./constants.mjs";
import { createFilesystemAcquisitionStore } from "./filesystemStore.mjs";
import {
  collectFoodicsBridgeStatus,
  inspectRuntimeReadiness,
  resolveBridgePaths,
  resolveInvocationForLaunchd,
} from "./launchdWiring.mjs";
import { loadEnvFile, loadLocalAuthenticatedSource } from "./localSource.mjs";

const self = fileURLToPath(import.meta.url);
const hasStrip = process.execArgv.some((a) => a.includes("strip-types") || a.includes("transform-types"));
if (!hasStrip) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", self, ...process.argv.slice(2)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit === `--${name}`) return true;
  return hit.slice(name.length + 3);
}

function writeNotReady(paths, payload) {
  fs.mkdirSync(paths.proofDir, { recursive: true, mode: 0o700 });
  const body = { ...payload, schema: "nac-foodics-bridge-proof-v1", finalState: "SESSION_UNAVAILABLE", qualified: false };
  fs.writeFileSync(paths.lastProofPath, JSON.stringify(body, null, 2) + "\n");
}

const invokedBy = arg("invoked-by", "cli");
const explicitSource = arg("source") === true ? null : arg("source");
const branchId = arg("branch", process.env.NAC_FOODICS_BRANCH || DEFAULT_BRANCH);
const asOf = arg("as-of", new Date().toISOString());
const dryRun = Boolean(arg("dry-run"));
const scriptedOrdersPath = arg("scripted-orders");
const repoRoot = path.resolve(arg("repo") || path.resolve(path.dirname(self), "../.."));
const paths = resolveBridgePaths({
  repoRoot,
  bridgeHome: arg("bridge-home") || process.env.FOODICS_BRIDGE_HOME,
  stateRoot: arg("state-root") || process.env.NAC_FOODICS_STATE_ROOT,
  env: process.env,
});

loadEnvFile(path.join(paths.bridgeHome, ".env.local"), process.env);
loadEnvFile(path.join(repoRoot, ".env.local"), process.env);

globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } };
const fabric = await import(pathToFileURL(path.join(repoRoot, "supabase/functions/_shared/companyIntelligence/index.ts")).href);
const inNightlyWindow = fabric.isNightlySchedulerWindow(asOf);

const store = createFilesystemAcquisitionStore(paths.stateRoot, {
  invokedBy,
  launchdTrigger: invokedBy === "launchd"
    ? (inNightlyWindow ? "calendar" : "run-at-load")
    : "cli",
});

const planPreview = fabric.planCompletedDayAcquisition({
  asOf,
  publishedDates: store.getPublishedDates(branchId),
  watermark: store.getWatermark(branchId),
  openGaps: store.getOpenGaps(branchId),
});
const requestedSource = resolveInvocationForLaunchd({
  explicitSource: ["scheduler", "manual", "catch-up"].includes(explicitSource) ? explicitSource : null,
  invokedBy,
  gapCount: planPreview.datesOldestFirst.length,
  inNightlyWindow,
});

if (dryRun) {
  process.stdout.write(JSON.stringify({
    ok: true,
    dryRun: true,
    hardenedFn: HARDENED_BRIDGE_FN,
    requestedSource,
    plan: planPreview,
    currentDayExcluded: !planPreview.datesOldestFirst.includes(planPreview.currentRiyadhDate),
    paths,
  }, null, 2) + "\n");
  process.exit(0);
}

let sourcePack;
if (explicitSource === "scripted" || scriptedOrdersPath) {
  const ordersByDate = scriptedOrdersPath
    ? JSON.parse(fs.readFileSync(scriptedOrdersPath, "utf8"))
    : {};
  sourcePack = { kind: "scripted", ready: true, source: fabric.createScriptedFoodicsSource({ ordersByDate }) };
} else {
  sourcePack = await loadLocalAuthenticatedSource({
    env: process.env,
    bridgeHome: paths.bridgeHome,
    repoEnvFile: path.join(repoRoot, ".env.local"),
  });
}

if (!sourcePack.ready) {
  const runtime = inspectRuntimeReadiness({ paths, env: process.env, repoRoot });
  writeNotReady(paths, {
    runId: `unready-${Date.now()}`,
    invocationSource: requestedSource,
    launchdTrigger: invokedBy === "launchd" ? (inNightlyWindow ? "calendar" : "run-at-load") : "cli",
    invokedBy,
    branchId,
    reason: sourcePack.reason || "foodics_session_unavailable",
    runtime,
    writtenAt: new Date().toISOString(),
  });
  process.stdout.write(JSON.stringify({
    ok: false,
    hardenedFn: HARDENED_BRIDGE_FN,
    reason: sourcePack.reason || "foodics_session_unavailable",
    requestedSource,
    plan: planPreview,
    runtime,
  }, null, 2) + "\n");
  process.exit(0);
}

const result = await fabric.runAuthenticatedFoodicsBridge({
  branchId,
  asOf,
  source: sourcePack.source,
  store,
  requestedSource,
});

const status = collectFoodicsBridgeStatus({
  repoRoot,
  stateRoot: paths.stateRoot,
  bridgeHome: paths.bridgeHome,
  env: process.env,
  nextMissingCompletedDate: fabric.planCompletedDayAcquisition({
    asOf,
    publishedDates: store.getPublishedDates(branchId),
    watermark: store.getWatermark(branchId),
    openGaps: store.getOpenGaps(branchId),
  }).datesOldestFirst[0] || null,
});

process.stdout.write(JSON.stringify({
  ok: result.failedDates.length === 0,
  hardenedFn: HARDENED_BRIDGE_FN,
  invocationSource: result.plan.invocationSource,
  launchdTrigger: invokedBy === "launchd" ? (inNightlyWindow ? "calendar" : "run-at-load") : "cli",
  publishedDates: result.publishedDates,
  watermark: result.watermark,
  failedDates: result.failedDates,
  mondayOffRecoversOnNextRun: result.mondayOffRecoversOnNextRun,
  officialExportStatus: result.officialExportStatus,
  currentDayExcluded: !result.plan.datesOldestFirst.includes(result.plan.currentRiyadhDate),
  states: result.results.map((row) => ({ date: row.run.businessDate, state: row.run.state, idempotency: row.idempotencyResult })),
  proofPath: paths.lastProofPath,
  status,
}, null, 2) + "\n");

process.exit(result.failedDates.length ? 1 : 0);
