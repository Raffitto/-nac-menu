/**
 * Deterministic LaunchAgent install/update + status planning.
 * Safe to run on Linux CI: never claims macOS execution.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BRANCH,
  DEFAULT_FOODICS_BRIDGE_HOME,
  ENTRYPOINT_REL,
  FOODICS_BRIDGE_LABEL,
  FOODICS_BRIDGE_NIGHTLY,
  HARDENED_BRIDGE_FN,
  PROOF_SCHEMA,
} from "./constants.mjs";

export {
  DEFAULT_BRANCH,
  DEFAULT_FOODICS_BRIDGE_HOME,
  ENTRYPOINT_REL,
  FOODICS_BRIDGE_LABEL,
  FOODICS_BRIDGE_NIGHTLY,
  HARDENED_BRIDGE_FN,
  PROOF_SCHEMA,
};

export function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function detectRepoRoot(fromFile = import.meta.filename) {
  return path.resolve(path.dirname(fromFile), "../..");
}

export function resolveNodePath(env = process.env, candidates = []) {
  const fromEnv = env.FOODICS_BRIDGE_NODE || env.NODE_BINARY;
  const list = [
    fromEnv,
    ...candidates,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
  ].filter(Boolean);
  for (const candidate of list) {
    if (candidate && fs.existsSync(candidate) && !candidate.includes("nvm/shim")) {
      return candidate;
    }
  }
  return process.execPath;
}

export function resolveBridgePaths(input = {}) {
  const env = input.env || {};
  const homedir = input.homedir || os.homedir();
  const repoRoot = path.resolve(input.repoRoot || detectRepoRoot());
  const bridgeHome = path.resolve(
    input.bridgeHome
      || env.FOODICS_BRIDGE_HOME
      || DEFAULT_FOODICS_BRIDGE_HOME,
  );
  const stateRoot = path.resolve(
    input.stateRoot
      || env.NAC_FOODICS_STATE_ROOT
      || path.join(homedir, "Library", "Application Support", "nac", "foodics-bridge"),
  );
  const launchAgentsDir = path.resolve(
    input.launchAgentsDir
      || env.NAC_FOODICS_LAUNCH_AGENTS_DIR
      || path.join(homedir, "Library", "LaunchAgents"),
  );
  const logsDir = path.join(stateRoot, "logs");
  const proofDir = path.join(stateRoot, "proof");
  const entrypointPath = path.join(repoRoot, ENTRYPOINT_REL);
  const plistPath = path.join(launchAgentsDir, `${FOODICS_BRIDGE_LABEL}.plist`);
  return {
    repoRoot,
    bridgeHome,
    stateRoot,
    launchAgentsDir,
    logsDir,
    proofDir,
    entrypointPath,
    plistPath,
    stdoutPath: path.join(logsDir, "foodics-bridge.stdout.log"),
    stderrPath: path.join(logsDir, "foodics-bridge.stderr.log"),
    lastProofPath: path.join(proofDir, "last.json"),
    watermarkPath: path.join(stateRoot, "watermark.json"),
    proofStatePath: path.join(stateRoot, "proof-state.json"),
  };
}

export function proofFilePaths(stateRoot, extra = {}) {
  const proofDir = path.join(stateRoot, "proof");
  const runId = extra.runId || "unknown";
  const branchId = extra.branchId || DEFAULT_BRANCH;
  const businessDate = extra.businessDate || "undated";
  return {
    proofDir,
    runPath: path.join(proofDir, "runs", `${runId}.json`),
    datePath: path.join(proofDir, "dates", branchId, `${businessDate}.json`),
    lastPath: path.join(proofDir, "last.json"),
    invocationIndexPath: path.join(proofDir, "by-invocation", extra.invocationSource || "unknown", `${runId}.json`),
  };
}

export function renderLaunchAgentPlist(config) {
  const hour = config.hour ?? FOODICS_BRIDGE_NIGHTLY.hour;
  const minute = config.minute ?? FOODICS_BRIDGE_NIGHTLY.minute;
  const runAtLoad = config.runAtLoad !== false;
  const args = [
    config.nodePath,
    "--experimental-strip-types",
    config.entrypointPath,
    "--invoked-by=launchd",
    `--branch=${config.branchId || DEFAULT_BRANCH}`,
  ];
  const envPairs = {
    TZ: FOODICS_BRIDGE_NIGHTLY.timezone,
    FOODICS_BRIDGE_HOME: config.bridgeHome,
    NAC_FOODICS_STATE_ROOT: config.stateRoot,
    NAC_REPO_ROOT: config.repoRoot,
    NAC_FOODICS_BRANCH: config.branchId || DEFAULT_BRANCH,
  };
  const envXml = Object.entries(envPairs).map(([k, v]) => (
    `    <key>${xmlEscape(k)}</key>\n    <string>${xmlEscape(v)}</string>`
  )).join("\n");
  const argsXml = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(FOODICS_BRIDGE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(config.repoRoot)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <${runAtLoad ? "true" : "false"}/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(config.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(config.stderrPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>Nice</key>
  <integer>5</integer>
  <key>ThrottleInterval</key>
  <integer>3600</integer>
</dict>
</plist>
`;
}

function extractAfterKey(xml, key) {
  const idx = xml.indexOf(`<key>${key}</key>`);
  if (idx < 0) return "";
  return xml.slice(idx);
}

export function parsePlistProgramArguments(xml) {
  const slice = extractAfterKey(xml, "ProgramArguments");
  const array = slice.match(/<array>([\s\S]*?)<\/array>/);
  if (!array) return [];
  return [...array[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'"));
}

export function parsePlistSchedule(xml) {
  const slice = extractAfterKey(xml, "StartCalendarInterval");
  const hour = Number((slice.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/) || [])[1]);
  const minute = Number((slice.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/) || [])[1]);
  const runAtLoad = /<key>RunAtLoad<\/key>\s*<true\/>/.test(xml);
  const label = (xml.match(/<key>Label<\/key>\s*<string>([\s\S]*?)<\/string>/) || [])[1] || null;
  return { label, hour, minute, runAtLoad };
}

export function describeSchedulerCommand(args) {
  const entrypointPath = args.find((a) => String(a).endsWith(ENTRYPOINT_REL)) || null;
  return {
    nodePath: args[0] || null,
    entrypointPath,
    stripTypes: args.includes("--experimental-strip-types"),
    invokedBy: (args.find((a) => a.startsWith("--invoked-by=")) || "").slice("--invoked-by=".length) || null,
    invokesHardenedBridge: Boolean(entrypointPath),
    hardenedFn: HARDENED_BRIDGE_FN,
  };
}

export function resolveInvocationForLaunchd(input) {
  if (input.explicitSource) return input.explicitSource;
  const gapCount = Number(input.gapCount || 0);
  const nightly = input.inNightlyWindow === true;
  if (input.invokedBy === "launchd") {
    if (gapCount > 1) return "catch-up";
    if (nightly && gapCount <= 1) return "scheduler";
    if (gapCount === 1) return "catch-up";
    return nightly ? "scheduler" : "catch-up";
  }
  if (gapCount > 1) return "catch-up";
  if (nightly) return "scheduler";
  return "manual";
}

export function inspectRuntimeReadiness(input = {}) {
  const io = input.fs || fs;
  const env = input.env || {};
  const paths = input.paths || resolveBridgePaths(input);
  const envFile = path.join(paths.bridgeHome, ".env.local");
  const sessionDir = path.join(paths.bridgeHome, "session");
  const cookieFileCandidates = [
    env.FOODICS_SESSION_FILE,
    path.join(sessionDir, "cookies.txt"),
    path.join(sessionDir, "cookies.json"),
    path.join(paths.bridgeHome, "cookies.txt"),
  ].filter(Boolean);
  const sourceModuleCandidates = [
    env.FOODICS_BRIDGE_SOURCE_MODULE,
    path.join(paths.bridgeHome, "nac-source.mjs"),
    path.join(paths.bridgeHome, "authenticated-source.mjs"),
    path.join(paths.bridgeHome, "src/foodicsSource.mjs"),
  ].filter(Boolean);
  const chromeProfile = env.FOODICS_CHROME_USER_DATA_DIR || env.FOODICS_CHROME_PROFILE || null;
  const cookieFile = cookieFileCandidates.find((p) => io.existsSync(p)) || null;
  const sourceModule = sourceModuleCandidates.find((p) => io.existsSync(p)) || null;
  const envFileExists = io.existsSync(envFile);
  const sessionDirExists = io.existsSync(sessionDir);
  const chromeExists = Boolean(chromeProfile && io.existsSync(chromeProfile));
  const cookieEnv = Boolean(env.FOODICS_CONSOLE_COOKIE || env.FOODICS_AUTHORIZATION);
  const entrypointExists = io.existsSync(paths.entrypointPath);
  const sessionReady = cookieEnv || Boolean(cookieFile) || Boolean(sourceModule) || chromeExists;
  const ready = entrypointExists && sessionReady;
  const reasons = [];
  if (!entrypointExists) reasons.push("entrypoint_missing");
  if (!sessionReady) reasons.push("foodics_session_unavailable");
  return {
    ready,
    fabricated: false,
    entrypointExists,
    entrypointPath: paths.entrypointPath,
    bridgeHome: paths.bridgeHome,
    bridgeHomeExists: io.existsSync(paths.bridgeHome),
    envFile: envFileExists ? envFile : null,
    sessionDir: sessionDirExists ? sessionDir : null,
    cookieFile,
    cookieEnvPresent: cookieEnv,
    sourceModule,
    chromeProfile: chromeExists ? chromeProfile : null,
    reasons: ready ? [] : reasons,
  };
}

export function requiredDirectories(paths) {
  return [
    paths.stateRoot,
    paths.logsDir,
    paths.proofDir,
    path.join(paths.proofDir, "runs"),
    path.join(paths.proofDir, "dates"),
    path.join(paths.proofDir, "by-invocation"),
    path.join(paths.proofDir, "by-invocation", "scheduler"),
    path.join(paths.proofDir, "by-invocation", "manual"),
    path.join(paths.proofDir, "by-invocation", "catch-up"),
    paths.launchAgentsDir,
  ];
}

export function planLaunchAgentInstall(input = {}) {
  const io = input.fs || fs;
  const paths = resolveBridgePaths(input);
  const nodePath = input.nodePath || resolveNodePath(input.env || process.env);
  const plist = renderLaunchAgentPlist({
    nodePath,
    entrypointPath: paths.entrypointPath,
    repoRoot: paths.repoRoot,
    stateRoot: paths.stateRoot,
    bridgeHome: paths.bridgeHome,
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    branchId: input.branchId || DEFAULT_BRANCH,
    hour: FOODICS_BRIDGE_NIGHTLY.hour,
    minute: FOODICS_BRIDGE_NIGHTLY.minute,
    runAtLoad: true,
  });
  const existing = io.existsSync(paths.plistPath) ? io.readFileSync(paths.plistPath, "utf8") : null;
  let abort = null;
  if (existing) {
    const parsed = parsePlistSchedule(existing);
    if (parsed.label && parsed.label !== FOODICS_BRIDGE_LABEL) {
      abort = `existing_plist_label_mismatch:${parsed.label}`;
    }
  }
  const unchanged = Boolean(existing && existing === plist);
  const backupPath = existing && !unchanged && !abort
    ? `${paths.plistPath}.bak`
    : null;
  const platform = input.platform || process.platform;
  const launchctlAvailable = platform === "darwin" && input.launchctlAvailable !== false;
  return {
    abort,
    unchanged,
    dryRun: Boolean(input.dryRun),
    platform,
    launchctlAvailable,
    macExecutionRequired: platform !== "darwin",
    label: FOODICS_BRIDGE_LABEL,
    schedule: { ...FOODICS_BRIDGE_NIGHTLY, runAtLoad: true },
    nodePath,
    command: describeSchedulerCommand(parsePlistProgramArguments(plist)),
    paths,
    directories: requiredDirectories(paths),
    plist,
    backupPath,
    launchctl: launchctlAvailable
      ? {
          bootout: ["launchctl", "bootout", `gui/${input.uid || "UID"}/${FOODICS_BRIDGE_LABEL}`],
          bootstrap: ["launchctl", "bootstrap", `gui/${input.uid || "UID"}`, paths.plistPath],
        }
      : { skipped: platform === "darwin" ? "launchctl_disabled" : "not_darwin" },
  };
}

export function applyLaunchAgentInstall(plan, input = {}) {
  const io = input.fs || fs;
  if (plan.abort) {
    return { ok: false, abort: plan.abort, wrotePlist: false, reloaded: false };
  }
  if (plan.dryRun) {
    return {
      ok: true,
      dryRun: true,
      unchanged: plan.unchanged,
      wrotePlist: false,
      reloaded: false,
      macExecutionRequired: plan.macExecutionRequired,
      paths: plan.paths,
      command: plan.command,
      schedule: plan.schedule,
    };
  }
  for (const dir of plan.directories) {
    io.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (plan.backupPath && io.existsSync(plan.paths.plistPath)) {
    io.copyFileSync(plan.paths.plistPath, plan.backupPath);
  }
  if (!plan.unchanged) {
    io.writeFileSync(plan.paths.plistPath, plan.plist, { encoding: "utf8", mode: 0o644 });
  }
  let reloaded = false;
  let launchctlError = null;
  if (!plan.macExecutionRequired && plan.launchctlAvailable && typeof input.execFileSync === "function") {
    try {
      try {
        input.execFileSync(plan.launchctl.bootout[0], plan.launchctl.bootout.slice(1), { encoding: "utf8" });
      } catch {
        // bootout fails if not loaded; that is non-destructive and expected
      }
      input.execFileSync(plan.launchctl.bootstrap[0], plan.launchctl.bootstrap.slice(1), { encoding: "utf8" });
      reloaded = true;
    } catch (err) {
      launchctlError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    ok: true,
    dryRun: false,
    unchanged: plan.unchanged,
    wrotePlist: !plan.unchanged,
    backedUp: Boolean(plan.backupPath),
    reloaded,
    launchctlError,
    macExecutionRequired: plan.macExecutionRequired,
    paths: plan.paths,
    command: plan.command,
    schedule: plan.schedule,
    label: plan.label,
  };
}

function readJsonIfPresent(io, filePath) {
  if (!io.existsSync(filePath)) return null;
  try {
    return JSON.parse(io.readFileSync(filePath, "utf8"));
  } catch {
    return { unreadable: true, path: filePath };
  }
}

export function collectFoodicsBridgeStatus(input = {}) {
  const io = input.fs || fs;
  const paths = resolveBridgePaths(input);
  const runtime = inspectRuntimeReadiness({ ...input, paths, fs: io });
  const plistExists = io.existsSync(paths.plistPath);
  const plistXml = plistExists ? io.readFileSync(paths.plistPath, "utf8") : null;
  const parsed = plistXml ? parsePlistSchedule(plistXml) : null;
  const args = plistXml ? parsePlistProgramArguments(plistXml) : [];
  const lastProof = readJsonIfPresent(io, paths.lastProofPath);
  const watermarkDoc = readJsonIfPresent(io, paths.watermarkPath);
  const watermark = watermarkDoc && !watermarkDoc.unreadable
    ? (watermarkDoc[input.branchId || DEFAULT_BRANCH] || watermarkDoc.watermark || null)
    : null;
  let agentLoaded = null;
  let loadedObservable = false;
  let loadedReason = "launchctl_not_queried";
  if (input.launchctlListOutput != null) {
    loadedObservable = true;
    agentLoaded = String(input.launchctlListOutput).includes(FOODICS_BRIDGE_LABEL);
    loadedReason = agentLoaded ? "launchctl_list_hit" : "launchctl_list_miss";
  } else if ((input.platform || process.platform) !== "darwin") {
    loadedReason = "launchctl_unavailable";
  }
  return {
    fabricated: false,
    macExecutionClaimed: false,
    label: FOODICS_BRIDGE_LABEL,
    agent: {
      loaded: agentLoaded,
      loadedObservable,
      reason: loadedReason,
      plistPath: paths.plistPath,
      plistInstalled: plistExists,
    },
    schedule: parsed
      ? {
          timezone: FOODICS_BRIDGE_NIGHTLY.timezone,
          hour: parsed.hour,
          minute: parsed.minute,
          runAtLoad: parsed.runAtLoad,
          configured: parsed.hour === FOODICS_BRIDGE_NIGHTLY.hour
            && parsed.minute === FOODICS_BRIDGE_NIGHTLY.minute,
        }
      : {
          timezone: FOODICS_BRIDGE_NIGHTLY.timezone,
          hour: FOODICS_BRIDGE_NIGHTLY.hour,
          minute: FOODICS_BRIDGE_NIGHTLY.minute,
          runAtLoad: true,
          configured: false,
          reason: "plist_not_installed",
        },
    command: args.length ? describeSchedulerCommand(args) : {
      nodePath: null,
      entrypointPath: paths.entrypointPath,
      invokedBy: null,
      invokesHardenedBridge: false,
      hardenedFn: HARDENED_BRIDGE_FN,
    },
    lastRun: lastProof && !lastProof.unreadable
      ? {
          runId: lastProof.runId || null,
          invocationSource: lastProof.invocationSource || null,
          launchdTrigger: lastProof.launchdTrigger || null,
          businessDate: lastProof.targetBusinessDate || lastProof.businessDate || null,
          finalState: lastProof.finalState || null,
          at: lastProof.riyadhCompletedAt || lastProof.writtenAt || null,
          path: paths.lastProofPath,
        }
      : null,
    lastProof: lastProof && !lastProof.unreadable ? lastProof : null,
    publishedThrough: watermark || null,
    watermark: watermark || null,
    nextMissingCompletedDate: input.nextMissingCompletedDate ?? null,
    runtime,
    proofPath: paths.lastProofPath,
    stateRoot: paths.stateRoot,
  };
}

export function buildProofArtifact(input) {
  return {
    schema: PROOF_SCHEMA,
    runId: input.runId,
    invocationSource: input.invocationSource,
    launchdTrigger: input.launchdTrigger || null,
    invokedBy: input.invokedBy || null,
    riyadhStartedAt: input.riyadhStartedAt || null,
    riyadhCompletedAt: input.riyadhCompletedAt || null,
    targetBusinessDate: input.targetBusinessDate,
    branchId: input.branchId,
    acquisitionMethod: input.acquisitionMethod || "authenticated_read",
    listingCount: input.listingCount ?? null,
    fetchedDetailCount: input.fetchedDetailCount ?? null,
    itemCount: input.itemCount ?? null,
    rawChecksums: input.rawChecksums || {},
    canonicalOrderCount: input.canonicalOrderCount ?? null,
    canonicalItemCount: input.canonicalItemCount ?? null,
    canonicalSessionCount: input.canonicalSessionCount ?? null,
    previousWatermark: input.previousWatermark ?? null,
    newWatermark: input.newWatermark ?? null,
    publicationDestination: input.publicationDestination || null,
    publicationVersion: input.publicationVersion || null,
    idempotencyResult: input.idempotencyResult || null,
    finalState: input.finalState || null,
    qualified: input.qualified === true,
    proofClassification: input.proofClassification || null,
    officialExport: input.officialExport || null,
    writtenAt: input.writtenAt || new Date().toISOString(),
  };
}
