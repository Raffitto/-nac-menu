/**
 * @jest-environment node
 */
/**
 * NAC-FOODICS-0001: authenticated completed-day acquisition,
 * catch-up, idempotency, evidence, and official-export classification.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
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

describe("foodicsBridge authenticated completed-day acquisition", () => {
  test("normal previous-day acquisition canonicalizes and persists checksum evidence", () => {
    const out = run(`
      const date = "2026-08-15";
      const source = mod.createScriptedFoodicsSource({
        ordersByDate: {
          [date]: [
            mod.buildFoodicsConsoleOrder({ id: "ord-a", businessDate: date, itemNames: ["Cookies", "Still Water"] }),
            mod.buildFoodicsConsoleOrder({ id: "ord-b", businessDate: date, itemNames: ["Brownie"] }),
          ],
        },
      });
      const store = mod.createMemoryAcquisitionStore();
      const result = await mod.acquireCompletedBusinessDate({
        branchId: "khobar",
        businessDate: date,
        asOf: "2026-08-16T01:30:00+03:00",
        source,
        store,
        invocationSource: "scheduler",
        runId: "run-normal",
        now: "2026-08-16T01:31:00+03:00",
      });
      const canonical = store.getCanonical("khobar", date);
      return {
        state: result.run.state,
        idempotency: result.idempotencyResult,
        previous: result.previousWatermark,
        watermark: result.newWatermark,
        listing: result.evidence.listingCount,
        details: result.evidence.fetchedDetailCount,
        orders: result.evidence.canonicalOrderCount,
        items: result.evidence.canonicalItemCount,
        sessions: result.evidence.canonicalSessionCount,
        checksum: result.evidence.rawChecksums.rawBatch,
        listingChecksum: result.evidence.rawChecksums.listing,
        method: result.evidence.acquisitionMethod,
        destination: result.evidence.publicationDestination,
        version: result.evidence.publicationVersion,
        qualified: result.evidence.qualified,
        classification: result.evidence.proofClassification,
        started: result.evidence.riyadhStartedAt,
        sourceListCalls: source.listCalls,
        detailCalls: source.detailCalls.length,
        persisted: store.getEvidence("run-normal")?.runId,
        sessionBranch: canonical?.sessions[0]?.branchId,
      };
    `);
    expect(out.state).toBe("PUBLISHED");
    expect(out.idempotency).toBe("published_new");
    expect(out.previous).toBeNull();
    expect(out.watermark).toBe("2026-08-15");
    expect(out.listing).toBe(2);
    expect(out.details).toBe(2);
    expect(out.orders).toBe(2);
    expect(out.items).toBe(3);
    expect(out.sessions).toBe(2);
    expect(out.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(out.listingChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(out.method).toBe("authenticated_read");
    expect(out.destination).toMatch(/commerce_orders/);
    expect(out.version).toBe("commerce-sessions-v1");
    expect(out.qualified).toBe(true);
    expect(out.classification).toBe("FULL_CHAIN_PROOF_SUCCESS");
    expect(out.started).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.sourceListCalls).toEqual(["2026-08-15"]);
    expect(out.detailCalls).toBe(2);
    expect(out.persisted).toBe("run-normal");
    expect(out.sessionBranch).toBe("khobar");
  });

  test("current Riyadh date is excluded and never published", () => {
    const out = run(`
      const asOf = "2026-08-16T01:30:00+03:00";
      const plan = mod.planCompletedDayAcquisition({
        asOf,
        publishedDates: [],
        epochStart: "2026-08-14",
      });
      const source = mod.createScriptedFoodicsSource({
        ordersByDate: {
          "2026-08-16": [mod.buildFoodicsConsoleOrder({ id: "today", businessDate: "2026-08-16" })],
        },
      });
      const store = mod.createMemoryAcquisitionStore();
      const blocked = await mod.acquireCompletedBusinessDate({
        branchId: "khobar",
        businessDate: "2026-08-16",
        asOf,
        source,
        store,
        invocationSource: "manual",
        runId: "run-today",
      });
      return {
        current: plan.currentRiyadhDate,
        newestSafe: plan.newestSafeCompletedDate,
        dates: plan.datesOldestFirst,
        includesToday: plan.datesOldestFirst.includes("2026-08-16"),
        state: blocked.run.state,
        published: store.getPublishedDates("khobar"),
        error: blocked.run.error,
      };
    `);
    expect(out.current).toBe("2026-08-16");
    expect(out.newestSafe).toBe("2026-08-15");
    expect(out.includesToday).toBe(false);
    expect(out.dates).toEqual(["2026-08-14", "2026-08-15"]);
    expect(out.state).toBe("VALIDATE_FAILED");
    expect(out.published).toEqual([]);
    expect(out.error).toBe("current_riyadh_date_excluded");
  });

  test("Riyadh midnight boundary uses previous civil date as newest safe", () => {
    const out = run(`
      return {
        before: {
          current: mod.riyadhCalendarDate("2026-08-15T23:59:59+03:00"),
          safe: mod.newestSafeCompletedDate("2026-08-15T23:59:59+03:00"),
        },
        midnight: {
          current: mod.riyadhCalendarDate("2026-08-16T00:00:00+03:00"),
          safe: mod.newestSafeCompletedDate("2026-08-16T00:00:00+03:00"),
        },
        nightly: {
          window: mod.isNightlySchedulerWindow("2026-08-16T01:30:00+03:00"),
          safe: mod.newestSafeCompletedDate("2026-08-16T01:30:00+03:00"),
        },
        utcMorning: {
          current: mod.riyadhCalendarDate("2026-08-15T21:30:00.000Z"),
          safe: mod.newestSafeCompletedDate("2026-08-15T21:30:00.000Z"),
        },
      };
    `);
    expect(out.before).toEqual({ current: "2026-08-15", safe: "2026-08-14" });
    expect(out.midnight).toEqual({ current: "2026-08-16", safe: "2026-08-15" });
    expect(out.nightly.window).toBe(true);
    expect(out.nightly.safe).toBe("2026-08-15");
    expect(out.utcMorning).toEqual({ current: "2026-08-16", safe: "2026-08-15" });
  });
});

describe("schedulerCatchup oldest-first recovery", () => {
  test("one missed-day catch-up acquires only the gap", () => {
    const out = run(`
      const asOf = "2026-08-16T01:30:00+03:00";
      const plan = mod.planCompletedDayAcquisition({
        asOf,
        publishedDates: ["2026-08-14"],
        watermark: "2026-08-14",
        requestedSource: "catch-up",
      });
      const source = mod.createScriptedFoodicsSource({
        ordersByDate: {
          "2026-08-15": [mod.buildFoodicsConsoleOrder({ id: "gap", businessDate: "2026-08-15" })],
        },
      });
      const store = mod.createMemoryAcquisitionStore({
        published: [{
          businessDate: "2026-08-14", listingCount: 1, listingChecksum: "x", rawChecksum: "y",
          orderCount: 1, itemCount: 1, sessionCount: 1, runId: "prior",
        }],
        watermark: "2026-08-14",
      });
      const bridge = await mod.runAuthenticatedFoodicsBridge({
        branchId: "khobar", asOf, source, store, requestedSource: "catch-up",
      });
      return { planDates: plan.datesOldestFirst, source: plan.invocationSource, published: bridge.publishedDates, watermark: bridge.watermark, states: bridge.results.map((r) => r.run.state) };
    `);
    expect(out.planDates).toEqual(["2026-08-15"]);
    expect(out.source).toBe("catch-up");
    expect(out.published).toEqual(["2026-08-14", "2026-08-15"]);
    expect(out.watermark).toBe("2026-08-15");
    expect(out.states).toEqual(["PUBLISHED"]);
  });

  test("Monday-off multi-date catch-up is oldest-first and recovers on next run", () => {
    const out = run(`
      const asOf = "2026-08-18T01:30:00+03:00";
      const source = mod.createScriptedFoodicsSource({
        ordersByDate: {
          "2026-08-16": [mod.buildFoodicsConsoleOrder({ id: "sun", businessDate: "2026-08-16", itemNames: ["Cookies"] })],
          "2026-08-17": [mod.buildFoodicsConsoleOrder({ id: "mon", businessDate: "2026-08-17", itemNames: ["Brownie"] })],
        },
      });
      const store = mod.createMemoryAcquisitionStore({
        published: [{
          businessDate: "2026-08-15", listingCount: 1, listingChecksum: "x", rawChecksum: "y",
          orderCount: 1, itemCount: 1, sessionCount: 1, runId: "sat",
        }],
        watermark: "2026-08-15",
      });
      const nightly = mod.nightlyCatchupDates({
        asOf, publishedDates: store.getPublishedDates("khobar"), watermark: store.getWatermark("khobar"),
      });
      const bridge = await mod.runAuthenticatedFoodicsBridge({
        branchId: "khobar", asOf, source, store,
      });
      return {
        nightly,
        current: bridge.plan.currentRiyadhDate,
        invocation: bridge.plan.invocationSource,
        order: bridge.results.map((r) => r.run.businessDate),
        states: bridge.results.map((r) => r.run.state),
        watermark: bridge.watermark,
        recovers: bridge.mondayOffRecoversOnNextRun,
        failed: bridge.failedDates,
      };
    `);
    expect(out.nightly).toEqual(["2026-08-16", "2026-08-17"]);
    expect(out.current).toBe("2026-08-18");
    expect(out.invocation).toBe("catch-up");
    expect(out.order).toEqual(["2026-08-16", "2026-08-17"]);
    expect(out.states).toEqual(["PUBLISHED", "PUBLISHED"]);
    expect(out.watermark).toBe("2026-08-17");
    expect(out.recovers).toBe(true);
    expect(out.failed).toEqual([]);
  });
});

describe("proofEvidence and idempotency", () => {
  test("partial detail failure is retryable and succeeds on recovery", () => {
    const out = run(`
      const date = "2026-08-15";
      const orders = [
        mod.buildFoodicsConsoleOrder({ id: "ord-a", businessDate: date }),
        mod.buildFoodicsConsoleOrder({ id: "ord-b", businessDate: date, itemNames: ["Brownie"] }),
      ];
      const store = mod.createMemoryAcquisitionStore();
      const failing = mod.createScriptedFoodicsSource({ ordersByDate: { [date]: orders }, failDetailIds: ["ord-b"] });
      const first = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source: failing, store, invocationSource: "scheduler", runId: "run-partial",
      });
      const publishedAfterFail = store.getPublishedDates("khobar");
      const recovering = mod.createScriptedFoodicsSource({ ordersByDate: { [date]: orders } });
      const second = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source: recovering, store, invocationSource: "scheduler", runId: "run-retry",
      });
      return {
        firstState: first.run.state,
        firstRetryable: first.run.retryable,
        firstQualified: first.evidence.qualified,
        publishedAfterFail,
        resumedDetails: recovering.detailCalls,
        secondState: second.run.state,
        watermark: second.newWatermark,
        qualified: second.evidence.qualified,
      };
    `);
    expect(out.firstState).toBe("ACQUIRE_FAILED");
    expect(out.firstRetryable).toBe(true);
    expect(out.firstQualified).toBe(false);
    expect(out.publishedAfterFail).toEqual([]);
    expect(out.resumedDetails).toEqual(["ord-b"]);
    expect(out.secondState).toBe("PUBLISHED");
    expect(out.watermark).toBe("2026-08-15");
    expect(out.qualified).toBe(true);
  });

  test("interrupted run resumes remaining details without counting as success", () => {
    const out = run(`
      const date = "2026-08-15";
      const orders = [
        mod.buildFoodicsConsoleOrder({ id: "ord-a", businessDate: date }),
        mod.buildFoodicsConsoleOrder({ id: "ord-b", businessDate: date }),
      ];
      const store = mod.createMemoryAcquisitionStore();
      const interrupting = mod.createScriptedFoodicsSource({ ordersByDate: { [date]: orders }, interruptAfter: 1 });
      const first = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source: interrupting, store, invocationSource: "manual", runId: "run-int",
      });
      const resuming = mod.createScriptedFoodicsSource({ ordersByDate: { [date]: orders } });
      const second = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source: resuming, store, invocationSource: "manual", runId: "run-resume",
      });
      return {
        firstState: first.run.state,
        firstRetryable: first.run.retryable,
        firstQualified: first.evidence.qualified,
        fetched: first.run.fetchedDetailCount,
        resumeCalls: resuming.detailCalls,
        secondState: second.run.state,
      };
    `);
    expect(out.firstState).toBe("INTERRUPTED");
    expect(out.firstRetryable).toBe(true);
    expect(out.firstQualified).toBe(false);
    expect(out.fetched).toBe(1);
    expect(out.resumeCalls).toEqual(["ord-b"]);
    expect(out.secondState).toBe("PUBLISHED");
  });

  test("duplicate run is a no-op except integrity verification and does not increment proof twice", () => {
    const out = run(`
      const date = "2026-08-15";
      const orders = [mod.buildFoodicsConsoleOrder({ id: "ord-a", businessDate: date, itemNames: ["Cookies"] })];
      const source = mod.createScriptedFoodicsSource({ ordersByDate: { [date]: orders } });
      const store = mod.createMemoryAcquisitionStore();
      const first = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source, store, invocationSource: "scheduler", runId: "run-1",
      });
      const second = await mod.acquireCompletedBusinessDate({
        branchId: "khobar", businessDate: date, asOf: "2026-08-16T01:30:00+03:00",
        source, store, invocationSource: "scheduler", runId: "run-2",
      });
      const proof = store.getProofState();
      return {
        first: first.run.state,
        second: second.run.state,
        idempotency: second.idempotencyResult,
        secondQualified: second.evidence.qualified,
        watermark: store.getWatermark("khobar"),
        successes: proof.genuineFullChainSuccesses,
        dates: proof.qualifiedBusinessDates,
        secondDetails: source.detailCalls.length,
      };
    `);
    expect(out.first).toBe("PUBLISHED");
    expect(out.second).toBe("IDEMPOTENT_NOOP");
    expect(out.idempotency).toBe("noop_verified");
    expect(out.secondQualified).toBe(false);
    expect(out.watermark).toBe("2026-08-15");
    expect(out.successes).toBe(1);
    expect(out.dates).toEqual(["2026-08-15"]);
    expect(out.secondDetails).toBe(1);
  });

  test("malformed source and legitimate zero-order days do not fake qualified proof", () => {
    const out = run(`
      const store = mod.createMemoryAcquisitionStore();
      const malformed = await mod.acquireCompletedBusinessDate({
        branchId: "khobar",
        businessDate: "2026-08-14",
        asOf: "2026-08-16T01:30:00+03:00",
        source: mod.createScriptedFoodicsSource({
          ordersByDate: { "2026-08-14": [{ id: "bad" }] },
          malformedById: { bad: { id: "bad", not: "foodics" } },
        }),
        store,
        invocationSource: "manual",
        runId: "run-bad",
      });
      const empty = await mod.acquireCompletedBusinessDate({
        branchId: "khobar",
        businessDate: "2026-08-15",
        asOf: "2026-08-16T01:30:00+03:00",
        source: mod.createScriptedFoodicsSource({ ordersByDate: { "2026-08-15": [] } }),
        store,
        invocationSource: "scheduler",
        runId: "run-zero",
      });
      return {
        malformedState: malformed.run.state,
        malformedQualified: malformed.evidence.qualified,
        emptyState: empty.run.state,
        emptyQualified: empty.evidence.qualified,
        emptyClass: empty.evidence.proofClassification,
        watermark: empty.newWatermark,
        exportStatus: mod.officialExportChainStatus(),
        mailbox: mod.MAILBOX_ADAPTER.status,
        proofN: store.getProofState().genuineFullChainSuccesses,
      };
    `);
    expect(out.malformedState).toBe("VALIDATE_FAILED");
    expect(out.malformedQualified).toBe(false);
    expect(out.emptyState).toBe("PUBLISHED");
    expect(out.emptyQualified).toBe(false);
    expect(out.emptyClass).toBe("EMPTY_ACQUISITION");
    expect(out.watermark).toBe("2026-08-15");
    expect(out.exportStatus).toBe("BLOCKED_EXTERNAL_DEPENDENCY");
    expect(out.mailbox).toBe("BLOCKED_EXTERNAL_DEPENDENCY");
    expect(out.proofN).toBe(0);
  });
});
