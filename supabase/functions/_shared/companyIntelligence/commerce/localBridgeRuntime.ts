/**
 * Repo-side Mac LaunchAgent wiring for the authenticated Foodics bridge.
 * Does not execute on the operator laptop — only deterministic install/run contracts.
 */

import { FOODICS_BRIDGE_NIGHTLY } from "./acquisitionCalendar.ts";
import type { AcquisitionEvidenceRecord, AcquisitionInvocationSource } from "./acquisitionEvidence.ts";
import { detectMissingCompletedDates } from "./acquisitionEngine.ts";

export const FOODICS_BRIDGE_LAUNCH_AGENT_LABEL = "com.nac.foodics-bridge.nightly";

export const FOODICS_BRIDGE_LEGACY_ENV_PATH = "/Users/raffiazarian/Desktop/nac-menu-release/foodics-bridge/.env.local";

export type BridgePaths = {
  dataDir: string;
  logsDir: string;
  proofsDir: string;
  stateFile: string;
  lastRunFile: string;
  launchAgentPlist: string;
};

export type BridgeSchedulerSpec = {
  label: string;
  timezone: string;
  hour: number;
  minute: number;
  runAtLoad: boolean;
};

export type BridgeStatusInput = {
  paths: BridgePaths;
  scheduler: BridgeSchedulerSpec;
  branchId: string;
  asOf?: string;
  launchAgentLoaded?: boolean | null;
  installedCommand?: string | null;
  state?: {
    watermark?: string | null;
    publishedDates?: string[];
    proofState?: { genuineFullChainSuccesses?: number; qualifiedBusinessDates?: string[] };
    lastRun?: Record<string, unknown> | null;
    lastProof?: AcquisitionEvidenceRecord | null;
  } | null;
  sessionReady?: boolean | null;
  envReady?: boolean | null;
};

export type BridgeStatusReport = {
  ready: boolean;
  branchId: string;
  scheduler: BridgeSchedulerSpec;
  launchAgent: {
    label: string;
    loaded: boolean | null;
    installedCommand: string | null;
    plistPath: string;
  };
  publishedThrough: string | null;
  watermark: string | null;
  nextMissingCompletedDate: string | null;
  missingCompletedDates: string[];
  lastRun: Record<string, unknown> | null;
  lastProof: {
    runId: string | null;
    invocationSource: AcquisitionInvocationSource | null;
    targetBusinessDate: string | null;
    finalState: string | null;
    qualified: boolean | null;
    path: string | null;
  };
  paths: BridgePaths;
  sessionReady: boolean | null;
  envReady: boolean | null;
  notes: string[];
};

export function defaultBridgeDataDir(home: string): string {
  return `${home}/Library/Application Support/NAC/foodics-bridge`;
}

export function resolveBridgePaths(home: string, dataDir?: string | null): BridgePaths {
  const root = dataDir || defaultBridgeDataDir(home);
  return {
    dataDir: root,
    logsDir: `${root}/logs`,
    proofsDir: `${root}/proofs`,
    stateFile: `${root}/state.json`,
    lastRunFile: `${root}/last-run.json`,
    launchAgentPlist: `${home}/Library/LaunchAgents/${FOODICS_BRIDGE_LAUNCH_AGENT_LABEL}.plist`,
  };
}

export function bridgeSchedulerSpec(): BridgeSchedulerSpec {
  return {
    label: FOODICS_BRIDGE_LAUNCH_AGENT_LABEL,
    timezone: FOODICS_BRIDGE_NIGHTLY.timezone,
    hour: FOODICS_BRIDGE_NIGHTLY.hour,
    minute: FOODICS_BRIDGE_NIGHTLY.minute,
    runAtLoad: true,
  };
}

export function buildSchedulerCommand(input: {
  repoRoot: string;
  nodePath?: string;
  invocationSource?: AcquisitionInvocationSource;
}): string[] {
  const node = input.nodePath || "node";
  const args = [`${input.repoRoot}/scripts/foodics-bridge/run.mjs`];
  if (input.invocationSource && input.invocationSource !== "scheduler") {
    args.push("--source", input.invocationSource);
  }
  return [node, ...args];
}

export function buildLaunchAgentPlist(input: {
  label?: string;
  programArguments: string[];
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  scheduler?: BridgeSchedulerSpec;
}): string {
  const scheduler = input.scheduler || bridgeSchedulerSpec();
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${input.label || scheduler.label}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...input.programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(input.workingDirectory)}</string>`,
    "  <key>StartCalendarInterval</key>",
    "  <dict>",
    "    <key>Hour</key>",
    `    <integer>${scheduler.hour}</integer>`,
    "    <key>Minute</key>",
    `    <integer>${scheduler.minute}</integer>`,
    "  </dict>",
    "  <key>RunAtLoad</key>",
    `  <${scheduler.runAtLoad ? "true" : "false"}/>`,
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(input.stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(input.stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ];
  return lines.join("\n");
}

export function parseLaunchAgentProgramArguments(plistXml: string): string[] | null {
  const block = plistXml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!block) return null;
  const args: string[] = [];
  for (const match of block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)) {
    args.push(unescapeXml(match[1]));
  }
  return args.length ? args : null;
}

export function proofArtifactPath(paths: BridgePaths, branchId: string, businessDate: string, runId: string): string {
  return `${paths.proofsDir}/${branchId}/${businessDate}/${runId}.json`;
}

export function buildProofArtifactRecord(
  evidence: AcquisitionEvidenceRecord,
  meta: {
    branchId: string;
    invocationSource: AcquisitionInvocationSource;
    trigger: "scheduler" | "manual" | "catch-up" | "login-catch-up";
    artifactPath: string;
    repoRoot?: string | null;
    command?: string[] | null;
  },
): Record<string, unknown> {
  return {
    schema: "nac-foodics-proof-v1",
    artifactPath: meta.artifactPath,
    branchId: meta.branchId,
    invocationSource: meta.invocationSource,
    trigger: meta.trigger,
    command: meta.command || null,
    repoRoot: meta.repoRoot || null,
    evidence,
    writtenAt: new Date().toISOString(),
  };
}

export function buildBridgeStatusReport(input: BridgeStatusInput): BridgeStatusReport {
  const asOf = input.asOf || new Date().toISOString();
  const publishedDates = input.state?.publishedDates || [];
  const watermark = input.state?.watermark ?? null;
  const missing = detectMissingCompletedDates({
    asOf,
    publishedDates,
    watermark,
  });
  const lastProof = input.state?.lastProof || null;
  const notes: string[] = [];
  if (input.launchAgentLoaded == null) notes.push("launch_agent_load_state_unavailable");
  if (input.sessionReady == null) notes.push("foodics_session_state_unavailable");
  if (input.envReady === false) notes.push("required_env_missing");
  return {
    ready: Boolean(input.envReady) && input.sessionReady !== false,
    branchId: input.branchId,
    scheduler: input.scheduler,
    launchAgent: {
      label: input.scheduler.label,
      loaded: input.launchAgentLoaded ?? null,
      installedCommand: input.installedCommand ?? null,
      plistPath: input.paths.launchAgentPlist,
    },
    publishedThrough: watermark,
    watermark,
    nextMissingCompletedDate: missing[0] || null,
    missingCompletedDates: missing,
    lastRun: input.state?.lastRun || null,
    lastProof: {
      runId: lastProof?.runId || null,
      invocationSource: lastProof?.invocationSource || null,
      targetBusinessDate: lastProof?.targetBusinessDate || null,
      finalState: lastProof?.finalState || null,
      qualified: lastProof?.qualified ?? null,
      path: lastProof ? proofArtifactPath(
        input.paths,
        input.branchId,
        lastProof.targetBusinessDate,
        lastProof.runId,
      ) : null,
    },
    paths: input.paths,
    sessionReady: input.sessionReady ?? null,
    envReady: input.envReady ?? null,
    notes,
  };
}

export function installPlan(input: {
  repoRoot: string;
  home: string;
  nodePath?: string;
  dataDir?: string | null;
}): {
  paths: BridgePaths;
  scheduler: BridgeSchedulerSpec;
  command: string[];
  plist: string;
} {
  const paths = resolveBridgePaths(input.home, input.dataDir);
  const scheduler = bridgeSchedulerSpec();
  const command = buildSchedulerCommand({ repoRoot: input.repoRoot, nodePath: input.nodePath });
  const plist = buildLaunchAgentPlist({
    programArguments: command,
    workingDirectory: input.repoRoot,
    stdoutPath: `${paths.logsDir}/nightly.stdout.log`,
    stderrPath: `${paths.logsDir}/nightly.stderr.log`,
    scheduler,
  });
  return { paths, scheduler, command, plist };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
