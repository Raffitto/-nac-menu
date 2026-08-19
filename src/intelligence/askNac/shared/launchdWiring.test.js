/**
 * NAC-FOODICS-0002: LaunchAgent wiring, install/update, status, proof paths.
 * Does not claim Mac execution from this cloud environment.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const wiringPath = path.join(root, "scripts/foodics-bridge/launchdWiring.mjs");
const storePath = path.join(root, "scripts/foodics-bridge/filesystemStore.mjs");
const sourcePath = path.join(root, "scripts/foodics-bridge/localSource.mjs");
const nightly = path.join(root, "scripts/foodics-bridge/run-nightly.mjs");
const install = path.join(root, "scripts/foodics-bridge/install-launchagent.mjs");
const status = path.join(root, "scripts/foodics-bridge/status.mjs");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function parseJson(raw) {
  const text = String(raw).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`not_json:${text.slice(0, 400)}`);
  }
}

function runEsm(body) {
  const script = `
    import * as wiring from ${JSON.stringify(wiringPath)};
    import { createFilesystemAcquisitionStore } from ${JSON.stringify(storePath)};
    import { parseListingPayload } from ${JSON.stringify(sourcePath)};
    const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out));
  `;
  return parseJson(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 30000,
  }));
}

function runFabric(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return parseJson(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 30000,
  }));
}

function runCli(scriptPath, args, extra = {}) {
  const raw = execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(extra.env || {}) },
    timeout: extra.timeout || 30000,
  });
  return parseJson(raw);
}

describe("launchdWiring scheduler entrypoint", () => {
  test("plist invokes nightly entrypoint with 01:30 Asia/Riyadh and RunAtLoad", () => {
    const out = runEsm(`
      const xml = wiring.renderLaunchAgentPlist({
        nodePath: "/opt/homebrew/bin/node",
        entrypointPath: "/repo/scripts/foodics-bridge/run-nightly.mjs",
        repoRoot: "/repo",
        stateRoot: "/state",
        bridgeHome: "/bridge",
        stdoutPath: "/state/logs/out.log",
        stderrPath: "/state/logs/err.log",
      });
      const args = wiring.parsePlistProgramArguments(xml);
      const sched = wiring.parsePlistSchedule(xml);
      const cmd = wiring.describeSchedulerCommand(args);
      return {
        label: sched.label,
        hour: sched.hour,
        minute: sched.minute,
        runAtLoad: sched.runAtLoad,
        cmd,
        hasTz: xml.includes("Asia/Riyadh"),
        throttle: xml.includes("ThrottleInterval"),
      };
    `);
    expect(out.label).toBe("com.nac.foodics-bridge.nightly");
    expect(out.hour).toBe(1);
    expect(out.minute).toBe(30);
    expect(out.runAtLoad).toBe(true);
    expect(out.cmd.invokesHardenedBridge).toBe(true);
    expect(out.cmd.hardenedFn).toBe("runAuthenticatedFoodicsBridge");
    expect(out.cmd.invokedBy).toBe("launchd");
    expect(out.cmd.stripTypes).toBe(true);
    expect(out.cmd.entrypointPath).toMatch(/run-nightly\.mjs$/);
    expect(out.hasTz).toBe(true);
    expect(out.throttle).toBe(true);
  });

  test("schedule constants match the acquisition calendar", () => {
    const wiring = runEsm(`return wiring.FOODICS_BRIDGE_NIGHTLY;`);
    const cal = runFabric(`return mod.FOODICS_BRIDGE_NIGHTLY;`);
    expect(wiring).toEqual({ timezone: "Asia/Riyadh", hour: 1, minute: 30 });
    expect(cal).toEqual(wiring);
  });
});

describe("launchdWiring install/update", () => {
  test("install is repeatable and non-destructive", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nac-launchd-"));
    const first = runCli(install, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--launch-agents-dir=${path.join(dir, "LaunchAgents")}`,
      `--bridge-home=${path.join(dir, "missing-bridge")}`,
      `--platform=linux`,
      `--skip-launchctl`,
      `--node=${process.execPath}`,
    ]);
    expect(first.ok).toBe(true);
    expect(first.wrotePlist).toBe(true);
    expect(first.macExecutionClaimed).toBe(false);
    expect(first.macExecutionRequired).toBe(true);
    expect(first.schedule).toEqual({ timezone: "Asia/Riyadh", hour: 1, minute: 30, runAtLoad: true });
    expect(first.command.invokesHardenedBridge).toBe(true);
    expect(fs.existsSync(first.paths.plist)).toBe(true);
    expect(fs.existsSync(path.join(dir, "state", "proof"))).toBe(true);

    const proofMarker = path.join(dir, "state", "proof", "keep-me.json");
    fs.writeFileSync(proofMarker, "{\"keep\":true}\n");
    const originalPlist = fs.readFileSync(first.paths.plist, "utf8");

    const second = runCli(install, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--launch-agents-dir=${path.join(dir, "LaunchAgents")}`,
      `--bridge-home=${path.join(dir, "missing-bridge")}`,
      `--platform=linux`,
      `--skip-launchctl`,
      `--node=${process.execPath}`,
    ]);
    expect(second.ok).toBe(true);
    expect(second.unchanged).toBe(true);
    expect(second.wrotePlist).toBe(false);
    expect(fs.readFileSync(first.paths.plist, "utf8")).toBe(originalPlist);
    expect(JSON.parse(fs.readFileSync(proofMarker, "utf8"))).toEqual({ keep: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("mismatched existing label aborts without overwrite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nac-launchd-"));
    const agents = path.join(dir, "LaunchAgents");
    fs.mkdirSync(agents, { recursive: true });
    const plistPath = path.join(agents, "com.nac.foodics-bridge.nightly.plist");
    fs.writeFileSync(plistPath, "<plist><key>Label</key><string>com.other.job</string></plist>");
    const out = runEsm(`
      const plan = wiring.planLaunchAgentInstall({
        repoRoot: ${JSON.stringify(root)},
        launchAgentsDir: ${JSON.stringify(agents)},
        stateRoot: ${JSON.stringify(path.join(dir, "state"))},
        platform: "linux",
        dryRun: false,
      });
      const applied = wiring.applyLaunchAgentInstall(plan);
      return { abort: plan.abort, ok: applied.ok, wrote: applied.wrotePlist };
    `);
    expect(out.abort).toMatch(/label_mismatch/);
    expect(out.ok).toBe(false);
    expect(out.wrote).toBe(false);
    expect(fs.readFileSync(plistPath, "utf8")).toContain("com.other.job");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("launchdWiring status", () => {
  test("status handles missing local runtime/session without fabricating", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nac-status-"));
    const out = runCli(status, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--launch-agents-dir=${path.join(dir, "LaunchAgents")}`,
      `--bridge-home=${path.join(dir, "no-session")}`,
      `--as-of=2026-08-19T14:00:00+03:00`,
      `--skip-launchctl`,
    ]);
    expect(out.fabricated).toBe(false);
    expect(out.macExecutionClaimed).toBe(false);
    expect(out.agent.loaded).toBeNull();
    expect(out.agent.plistInstalled).toBe(false);
    expect(out.runtime.ready).toBe(false);
    expect(out.runtime.reasons).toContain("foodics_session_unavailable");
    expect(out.lastRun).toBeNull();
    expect(out.watermark).toBeNull();
    expect(out.schedule.hour).toBe(1);
    expect(out.schedule.minute).toBe(30);
    expect(out.nextMissingCompletedDate).toBe("2026-08-18");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("proofEvidence filesystem artifacts", () => {
  test("proof path metadata includes invocation source and launchd trigger", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nac-proof-"));
    const out = runEsm(`
      const store = createFilesystemAcquisitionStore(${JSON.stringify(dir)}, {
        invokedBy: "launchd",
        launchdTrigger: "calendar",
      });
      store.persistEvidence({
        runId: "run-sched",
        invocationSource: "scheduler",
        riyadhStartedAt: "2026-08-16T01:30:00+03:00",
        riyadhCompletedAt: "2026-08-16T01:31:00+03:00",
        targetBusinessDate: "2026-08-15",
        branchId: "khobar",
        acquisitionMethod: "authenticated_read",
        listingCount: 1,
        fetchedDetailCount: 1,
        itemCount: 1,
        rawChecksums: { listing: "aa", rawBatch: "bb" },
        canonicalOrderCount: 1,
        canonicalItemCount: 1,
        canonicalSessionCount: 1,
        previousWatermark: null,
        newWatermark: "2026-08-15",
        publicationDestination: "commerce_orders+commerce_order_items+commerce_sessions",
        publicationVersion: "commerce-sessions-v1",
        idempotencyResult: "published_new",
        finalState: "PUBLISHED",
        qualified: true,
        proofClassification: "FULL_CHAIN_PROOF_SUCCESS",
        officialExport: { exportRequestId: null },
      });
      const last = store.getEvidence("run-sched");
      return { last };
    `);
    const lastFile = JSON.parse(fs.readFileSync(path.join(dir, "proof/last.json"), "utf8"));
    const byInv = JSON.parse(fs.readFileSync(path.join(dir, "proof/by-invocation/scheduler/run-sched.json"), "utf8"));
    expect(out.last.invocationSource).toBe("scheduler");
    expect(lastFile.invocationSource).toBe("scheduler");
    expect(lastFile.launchdTrigger).toBe("calendar");
    expect(lastFile.schema).toBe("nac-foodics-bridge-proof-v1");
    expect(byInv.invocationSource).toBe("scheduler");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("schedulerCatchup via nightly entrypoint", () => {
  test("nightly entrypoint calls authenticated bridge, excludes current day, catch-up oldest-first, idempotent rerun", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nac-nightly-"));
    const ordersPath = path.join(dir, "orders.json");
    const built = runFabric(`
      return {
        d16: mod.buildFoodicsConsoleOrder({ id: "sun", businessDate: "2026-08-16", itemNames: ["Cookies"] }),
        d17: mod.buildFoodicsConsoleOrder({ id: "mon", businessDate: "2026-08-17", itemNames: ["Brownie"] }),
      };
    `);
    fs.writeFileSync(ordersPath, JSON.stringify({
      "2026-08-16": [built.d16],
      "2026-08-17": [built.d17],
      "2026-08-18": [built.d16],
    }));
    const first = runCli(nightly, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--bridge-home=${path.join(dir, "bridge")}`,
      `--source=scripted`,
      `--scripted-orders=${ordersPath}`,
      `--as-of=2026-08-18T01:30:00+03:00`,
      `--invoked-by=launchd`,
      `--branch=khobar`,
    ], { timeout: 45000 });
    expect(first.hardenedFn).toBe("runAuthenticatedFoodicsBridge");
    expect(first.invocationSource).toBe("catch-up");
    expect(first.launchdTrigger).toBe("calendar");
    expect(first.currentDayExcluded).toBe(true);
    expect(first.publishedDates).toEqual(["2026-08-16", "2026-08-17"]);
    expect(first.watermark).toBe("2026-08-17");
    expect(first.mondayOffRecoversOnNextRun).toBe(true);
    expect(first.officialExportStatus).toBe("BLOCKED_EXTERNAL_DEPENDENCY");
    expect(first.states.map((s) => s.date)).toEqual(["2026-08-16", "2026-08-17"]);
    const last = JSON.parse(fs.readFileSync(path.join(dir, "state/proof/last.json"), "utf8"));
    expect(last.invocationSource).toBe("catch-up");

    const second = runCli(nightly, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--bridge-home=${path.join(dir, "bridge")}`,
      `--source=scripted`,
      `--scripted-orders=${ordersPath}`,
      `--as-of=2026-08-18T01:30:00+03:00`,
      `--invoked-by=launchd`,
      `--branch=khobar`,
    ], { timeout: 45000 });
    expect(second.states.length).toBeGreaterThan(0);
    expect(second.states.every((s) => s.state === "IDEMPOTENT_NOOP" && s.idempotency === "noop_verified")).toBe(true);
    expect(second.watermark).toBe("2026-08-17");
    expect(second.publishedDates).toEqual(["2026-08-16", "2026-08-17"]);

    const missed = runCli(nightly, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--bridge-home=${path.join(dir, "bridge")}`,
      `--source=scripted`,
      `--scripted-orders=${ordersPath}`,
      `--as-of=2026-08-18T14:00:00+03:00`,
      `--invoked-by=launchd`,
      `--branch=khobar`,
    ], { timeout: 45000 });
    expect(missed.invocationSource).toBe("catch-up");
    expect(missed.launchdTrigger).toBe("run-at-load");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("missing session is a graceful no-op with inspectable proof, not fabricated success", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nac-unready-"));
    const out = runCli(nightly, [
      `--repo=${root}`,
      `--state-root=${path.join(dir, "state")}`,
      `--bridge-home=${path.join(dir, "bridge")}`,
      `--as-of=2026-08-16T01:30:00+03:00`,
      `--invoked-by=launchd`,
    ]);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("foodics_session_unavailable");
    expect(out.hardenedFn).toBe("runAuthenticatedFoodicsBridge");
    const proof = JSON.parse(fs.readFileSync(path.join(dir, "state/proof/last.json"), "utf8"));
    expect(proof.finalState).toBe("SESSION_UNAVAILABLE");
    expect(proof.qualified).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("launchdWiring listing parser", () => {
  test("parses console listing payloads for order ids", () => {
    const out = runEsm(`
      return {
        nested: parseListingPayload({ data: [{ id: "a" }, { id: "b" }] }),
        items: parseListingPayload({ items: [{ uuid: "c" }] }),
      };
    `);
    expect(out.nested).toEqual({ orderIds: ["a", "b"], listingCount: 2 });
    expect(out.items).toEqual({ orderIds: ["c"], listingCount: 1 });
  });
});
