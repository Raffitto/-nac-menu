/**
 * NAC-FOODICS-0002: LaunchAgent wiring, local runtime, proof paths, install/status.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function run(body) {
  const script = `
    global.Deno = { env: { get: (k) => process.env[k] } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 30000,
  }).trim());
}

describe("launchdWiring scheduler entrypoint", () => {
  test("scheduler command invokes authenticated bridge entry script", () => {
    const out = run(`
      const command = mod.buildSchedulerCommand({ repoRoot: ${JSON.stringify(root)} });
      return {
        command,
        endsWithRunScript: command[1].endsWith("scripts/foodics-bridge/run.mjs"),
        label: mod.FOODICS_BRIDGE_LAUNCH_AGENT_LABEL,
      };
    `);
    expect(out.endsWithRunScript).toBe(true);
    expect(out.command[0]).toMatch(/node/);
    expect(out.label).toBe("com.nac.foodics-bridge.nightly");
  });

  test("01:30 Asia/Riyadh schedule is retained in LaunchAgent plist", () => {
    const out = run(`
      const scheduler = mod.bridgeSchedulerSpec();
      const plist = mod.buildLaunchAgentPlist({
        programArguments: mod.buildSchedulerCommand({ repoRoot: "/tmp/nac-menu" }),
        workingDirectory: "/tmp/nac-menu",
        stdoutPath: "/tmp/out.log",
        stderrPath: "/tmp/err.log",
      });
      return { scheduler, plist };
    `);
    expect(out.scheduler).toEqual({
      label: "com.nac.foodics-bridge.nightly",
      timezone: "Asia/Riyadh",
      hour: 1,
      minute: 30,
      runAtLoad: true,
    });
    expect(out.plist).toContain("<key>Hour</key>");
    expect(out.plist).toContain("<integer>1</integer>");
    expect(out.plist).toContain("<key>Minute</key>");
    expect(out.plist).toContain("<integer>30</integer>");
    expect(out.plist).toContain("<key>RunAtLoad</key>");
    expect(out.plist).toContain("<true/>");
  });

  test("install plan is repeatable and reports command plus schedule", () => {
    const first = run(`
      return mod.installPlan({ repoRoot: ${JSON.stringify(root)}, home: "/Users/tester", dataDir: "/tmp/nac-foodics" });
    `);
    const second = run(`
      return mod.installPlan({ repoRoot: ${JSON.stringify(root)}, home: "/Users/tester", dataDir: "/tmp/nac-foodics" });
    `);
    expect(first.command).toEqual(second.command);
    expect(first.plist).toBe(second.plist);
    expect(first.scheduler.minute).toBe(30);
    expect(first.paths.logsDir).toBe("/tmp/nac-foodics/logs");
    expect(first.paths.proofsDir).toBe("/tmp/nac-foodics/proofs");
  });
});

describe("launchdWiring catch-up and proof metadata", () => {
  test("scheduler entrypoint path uses runAuthenticatedFoodicsBridge semantics", async () => {
    const out = run(`
      const source = mod.createScriptedFoodicsSource({
        ordersByDate: {
          "2026-08-15": [mod.buildFoodicsConsoleOrder({ id: "ord-a", businessDate: "2026-08-15" })],
        },
      });
      const memFs = mod.createMemoryFileSystem();
      const store = mod.createLocalAcquisitionStore({
        paths: mod.resolveBridgePaths("/Users/tester", "/tmp/nac-foodics-runtime"),
        branchId: "khobar",
        fs: memFs,
      });
      const bridge = await mod.runAuthenticatedFoodicsBridge({
        branchId: "khobar",
        asOf: "2026-08-16T01:30:00+03:00",
        source,
        store,
      });
      const proofPath = store.writeProofArtifact(bridge.results[0].evidence, {
        trigger: "scheduler",
        command: mod.buildSchedulerCommand({ repoRoot: ${JSON.stringify(root)} }),
        repoRoot: ${JSON.stringify(root)},
      });
      const artifact = JSON.parse(memFs.read(proofPath));
      return {
        states: bridge.results.map((row) => row.run.state),
        invocation: bridge.plan.invocationSource,
        proofPath,
        artifactSource: artifact.invocationSource,
        artifactTrigger: artifact.trigger,
        includesEvidence: Boolean(artifact.evidence?.runId),
      };
    `);
    expect(out.states).toEqual(["PUBLISHED"]);
    expect(out.invocation).toBe("scheduler");
    expect(out.proofPath).toContain("proofs/khobar/2026-08-15/");
    expect(out.artifactSource).toBe("scheduler");
    expect(out.artifactTrigger).toBe("scheduler");
    expect(out.includesEvidence).toBe(true);
  });

  test("Monday-off catch-up remains oldest-first through bridge entrypoint", async () => {
    const out = run(`
      const source = mod.createScriptedFoodicsSource({
        ordersByDate: {
          "2026-08-16": [mod.buildFoodicsConsoleOrder({ id: "sun", businessDate: "2026-08-16" })],
          "2026-08-17": [mod.buildFoodicsConsoleOrder({ id: "mon", businessDate: "2026-08-17" })],
        },
      });
      const store = mod.createLocalAcquisitionStore({
        paths: mod.resolveBridgePaths("/Users/tester", "/tmp/nac-foodics-runtime-2"),
        branchId: "khobar",
        fs: mod.createMemoryFileSystem(),
      });
      store.publish({
        branchId: "khobar",
        businessDate: "2026-08-15",
        bundle: { orders: [], items: [], sessions: [] },
        record: {
          businessDate: "2026-08-15",
          listingCount: 1,
          listingChecksum: "x",
          rawChecksum: "y",
          orderCount: 1,
          itemCount: 1,
          sessionCount: 1,
          runId: "seed",
        },
      });
      const bridge = await mod.runAuthenticatedFoodicsBridge({
        branchId: "khobar",
        asOf: "2026-08-18T01:30:00+03:00",
        source,
        store,
      });
      return {
        order: bridge.results.map((row) => row.run.businessDate),
        invocation: bridge.plan.invocationSource,
        recovers: bridge.mondayOffRecoversOnNextRun,
      };
    `);
    expect(out.order).toEqual(["2026-08-16", "2026-08-17"]);
    expect(out.invocation).toBe("catch-up");
    expect(out.recovers).toBe(true);
  });

  test("current-day exclusion remains enforced through planner", () => {
    const out = run(`
      return mod.planCompletedDayAcquisition({
        asOf: "2026-08-16T01:30:00+03:00",
        publishedDates: [],
        epochStart: "2026-08-14",
      });
    `);
    expect(out.datesOldestFirst).toEqual(["2026-08-14", "2026-08-15"]);
    expect(out.datesOldestFirst.includes("2026-08-16")).toBe(false);
  });

  test("idempotent rerun remains a no-op with stable proof count", async () => {
    const out = run(`
      const date = "2026-08-15";
      const orders = [mod.buildFoodicsConsoleOrder({ id: "ord-a", businessDate: date })];
      const source = mod.createScriptedFoodicsSource({ ordersByDate: { [date]: orders } });
      const store = mod.createLocalAcquisitionStore({
        paths: mod.resolveBridgePaths("/Users/tester", "/tmp/nac-foodics-runtime-3"),
        branchId: "khobar",
        fs: mod.createMemoryFileSystem(),
      });
      const first = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source, store, invocationSource: "scheduler", runId: "run-1",
      });
      const second = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source, store, invocationSource: "scheduler", runId: "run-2",
      });
      return {
        first: first.run.state,
        second: second.run.state,
        proofN: store.getProofState().genuineFullChainSuccesses,
      };
    `);
    expect(out.first).toBe("PUBLISHED");
    expect(out.second).toBe("IDEMPOTENT_NOOP");
    expect(out.proofN).toBe(1);
  });
});

describe("launchdWiring status diagnostics", () => {
  test("status report handles missing local runtime/session gracefully", () => {
    const out = run(`
      const paths = mod.resolveBridgePaths("/Users/tester", "/tmp/nac-foodics-missing");
      return mod.buildBridgeStatusReport({
        paths,
        scheduler: mod.bridgeSchedulerSpec(),
        branchId: "khobar",
        launchAgentLoaded: null,
        installedCommand: null,
        state: null,
        sessionReady: null,
        envReady: false,
      });
    `);
    expect(out.ready).toBe(false);
    expect(out.launchAgent.loaded).toBeNull();
    expect(out.sessionReady).toBeNull();
    expect(out.envReady).toBe(false);
    expect(out.notes).toContain("launch_agent_load_state_unavailable");
    expect(out.notes).toContain("required_env_missing");
    expect(out.nextMissingCompletedDate).toBeTruthy();
  });

  test("foodics session readiness does not fabricate when env absent", () => {
    const out = run(`
      return {
        ready: mod.foodicsSessionReadyFromEnv({}),
        withCookie: mod.foodicsSessionReadyFromEnv({ FOODICS_SESSION_COOKIE: "abc" }),
      };
    `);
    expect(out.ready).toBe(false);
    expect(out.withCookie).toBe(true);
  });
});
