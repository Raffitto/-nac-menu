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
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }).trim());
}

describe("commerce trust integrity", () => {
  test("Cash Up canonical authority is structured facts net_sales", () => {
    const out = run(`
      return {
        table: mod.CANONICAL_CASH_UP.table,
        report: mod.CANONICAL_CASH_UP.reportType,
        metric: mod.CANONICAL_CASH_UP.metricKey,
        sales: mod.authorityForCommerceQuestion("headline_sales"),
        session: mod.authorityForCommerceQuestion("session_archetype"),
        headline: mod.selectSourceAuthority({ commercialMetric: "net_sales" }),
        basket: mod.selectSourceAuthority({ commerceFocus: "dessert_conversion" }),
        recon: mod.selectSourceAuthority({ commerceFocus: "reconciliation" }),
      };
    `);
    expect(out.table).toBe("ask_nac_structured_facts");
    expect(out.report).toBe("cash_up");
    expect(out.metric).toBe("net_sales");
    expect(out.sales).toBe("cash_up");
    expect(out.session).toBe("canonical_commerce_sessions");
    expect(out.headline).toBe("cash_up");
    expect(out.basket).toBe("canonical_commerce_sessions");
    expect(out.recon).toBe("explicit_comparison");
  });

  test("reconciliation keeps Cash Up and Foodics distinct and flags large ex-VAT gaps", () => {
    const out = run(`
      const ok = mod.reconcileHeadlineSales({
        branchId: "khobar", businessDate: "2026-08-14",
        cashUpSales: 23836.52, foodicsSales: 23896.52, foodicsIncVat: 27412,
      });
      const vatShaped = mod.reconcileHeadlineSales({
        branchId: "khobar", businessDate: "2026-08-14",
        cashUpSales: 23836.52, foodicsSales: 27412,
      });
      const daily = mod.pickDailyCashUpNetSales([
        { period_start: "2026-08-14", metric_value: 23836.52 },
        { period_start: "2026-08-14", metric_value: 23837 },
      ]);
      return { ok, vatShaped, picked: daily.get("2026-08-14") };
    `);
    expect(out.ok.coverage).toBe("both");
    expect(out.ok.health).toBe("ok");
    expect(out.ok.equalProven).toBe(false);
    expect(out.ok.note).toMatch(/ex-VAT|tax-inclusive/i);
    expect(Math.abs(out.vatShaped.percentageDifference)).toBeGreaterThan(3);
    expect(out.vatShaped.health).toBe("warning");
    expect(out.picked).toBe(23837);
  });

  test("quality terminology keeps mapping and classification separate", () => {
    const out = run(`
      const q = mod.computeQuality({
        uniqueProducts: 137, mappedProducts: 84, itemRows: 100, mappedItemRows: 84,
        revenue: 100, mappedRevenue: 92, sessions: 1000, unclassifiedSessions: 14, joinPct: 0.99,
      });
      const text = mod.qualityNarrative(q);
      const evidence = mod.buildEvidenceSummary({
        dataThrough: "2026-08-14", sessionsAnalyzed: 1178, quality: q, batchId: "commerce_batch_khobar_20260814_test",
      });
      return {
        q, text,
        dataUsed: mod.dataUsedAnswer(evidence),
        trust: mod.trustAnswer(evidence),
        health: mod.freshnessAnswer({
          dataThrough: "2026-08-14", lastIngestAt: "2026-08-15T00:00:00.000Z",
          status: "ready", ordersStatus: "ready", itemsStatus: "ready",
          publicationStatus: "published", quality: q,
        }),
        dataFocus: mod.extractCommerceFocus("What data did you use for that?"),
        healthFocus: mod.extractCommerceFocus("Is the data healthy?"),
        foodicsHealthFocus: mod.extractCommerceFocus("Is Foodics data healthy?"),
        trustFocus: mod.extractCommerceFocus("Can I trust this result?"),
        reconFocus: mod.extractCommerceFocus("Why are sales different from the Foodics check total?"),
      };
    `);
    expect(out.q.productUuidMappingPct).toBeCloseTo(84 / 137);
    expect(out.q.itemRowMappingPct).toBeCloseTo(0.84);
    expect(out.q.revenueMappingPct).toBeCloseTo(0.92);
    expect(out.q.confidentlyClassifiedSessionPct).toBeCloseTo(0.986);
    expect(out.q.unclassifiedSessionPct).toBeCloseTo(0.014);
    expect(out.text).toMatch(/98\.6% of sessions were classifiable/);
    expect(out.text).toMatch(/84\.0% of item rows/);
    expect(out.text).toMatch(/92\.0% of item revenue/);
    expect(out.dataUsed).not.toMatch(/99% mapped/);
    expect(out.dataUsed).toMatch(/not the same as product-UUID mapping/);
    expect(out.trust).toMatch(/Cash Up/);
    expect(out.health).toMatch(/authenticated_read_fallback|mailbox/);
    expect(out.dataFocus).toBe("data_used");
    expect(out.healthFocus).toBe("health");
    expect(out.foodicsHealthFocus).toBe("health");
    expect(out.trustFocus).toBe("trust");
    expect(out.reconFocus).toBe("reconciliation");
  });

  test("proof manifest and batch lineage stay correlated", () => {
    const out = run(`
      const q = mod.computeQuality({
        uniqueProducts: 10, mappedProducts: 6, itemRows: 100, mappedItemRows: 84,
        revenue: 100, mappedRevenue: 92, sessions: 100, unclassifiedSessions: 2, joinPct: 1,
      });
      const recon = mod.reconcileHeadlineSales({
        branchId: "khobar", businessDate: "2026-08-14", cashUpSales: 100, foodicsSales: 100.2,
      });
      const manifest = mod.buildProofManifest({
        branch: "Khobar",
        businessDate: "2026-08-14",
        batchId: "commerce_batch_khobar_20260814_abc",
        quality: q,
        orders: 86,
        orderItems: 400,
        orderItemJoinPct: 1,
        completedDineInSessions: 80,
        covers: 200,
        rawEvidence: [{ path: "/bridge/raw/foodics/orders/khobar/x.json", checksum: "deadbeef" }],
        checksums: { rawBatch: "deadbeef" },
        cashUpReconciliation: {
          state: mod.reconciliationState(recon),
          cashUpValue: recon.cashUpSales,
          foodicsValue: recon.foodicsSales,
          delta: recon.absoluteDifference,
          deltaPct: recon.percentageDifference,
        },
      });
      return { manifest, summary: mod.proofSummaryText(manifest) };
    `);
    expect(out.manifest.batchId).toBe("commerce_batch_khobar_20260814_abc");
    expect(out.manifest.lineage.batchId).toBe("commerce_batch_khobar_20260814_abc");
    expect(out.summary).toMatch(/commerce_batch_khobar_20260814_abc/);
    expect(out.summary).toMatch(/authenticated_read_fallback/);
    expect(out.summary).toMatch(/84\.0% item rows/);
  });

  test("proof counter disables visuals after five successes and re-enables on failure", () => {
    const out = run(`
      let state = mod.defaultProofState();
      const first = mod.shouldRecordVisuals(state);
      for (let i = 0; i < 5; i += 1) state = mod.applyProofSuccess(state);
      const afterFive = { record: mod.shouldRecordVisuals(state), enabled: state.visualEnabled, n: state.consecutiveSuccesses };
      const failed = mod.applyProofFailure(state);
      const modeChange = mod.applyProofTrigger(mod.defaultProofState(), { sourceModeChanged: true });
      const forcedOff = mod.shouldRecordVisuals({ ...mod.defaultProofState(), force: "off" });
      const nextRun = mod.shouldRecordVisuals({ ...mod.defaultProofState(), visualEnabled: false, consecutiveSuccesses: 5, force: "next-run" });
      return { first, afterFive, failed, modeChange, forcedOff, nextRun };
    `);
    expect(out.first).toBe(true);
    expect(out.afterFive.record).toBe(false);
    expect(out.afterFive.enabled).toBe(false);
    expect(out.afterFive.n).toBe(5);
    expect(out.failed.visualEnabled).toBe(true);
    expect(out.failed.consecutiveSuccesses).toBe(0);
    expect(out.modeChange.visualEnabled).toBe(true);
    expect(out.forcedOff).toBe(false);
    expect(out.nextRun).toBe(true);
  });

  test("only FULL_CHAIN_PROOF_SUCCESS increments the genuine 5-run counter", () => {
    const out = run(`
      const empty = mod.classifyProofRun({
        sourceDate: "2026-08-15", forbiddenDates: ["2026-08-15"], sourceCompleted: false, sourceNonEmpty: false,
        liveListCount: 0, liveDetailCalls: 0, acquiredOrders: 0, acquiredItems: 0, rawBytes: 0, checksum: null,
        representativeOrderId: null, batchId: "x", ingestOk: false, validationPass: false, publicationOk: false, lineageBatchIdsMatch: false,
      });
      const checkpointOnly = mod.classifyProofRun({
        sourceDate: "2026-08-14", sourceCompleted: true, sourceNonEmpty: true,
        liveListCount: 0, liveDetailCalls: 0, acquiredOrders: 80, acquiredItems: 400, rawBytes: 12, checksum: "abc",
        representativeOrderId: null, batchId: "b", ingestOk: true, validationPass: true, publicationOk: true, lineageBatchIdsMatch: true,
      });
      const full = mod.classifyProofRun({
        sourceDate: "2026-08-14", sourceCompleted: true, sourceNonEmpty: true,
        liveListCount: 30, liveDetailCalls: 86, acquiredOrders: 86, acquiredItems: 400, rawBytes: 50000, checksum: "abc",
        representativeOrderId: "ord-1", batchId: "commerce_batch_khobar_20260814_x", ingestOk: true, validationPass: true, publicationOk: true, lineageBatchIdsMatch: true,
      });
      let state = mod.defaultProofState();
      state = mod.applyQualifiedProofResult(state, empty);
      const afterEmpty = state.genuineFullChainSuccesses;
      state = mod.applyQualifiedProofResult(state, checkpointOnly);
      const afterCk = state.genuineFullChainSuccesses;
      state = mod.applyQualifiedProofResult(state, full);
      return { empty, checkpointOnly, full, afterEmpty, afterCk, afterFull: state.genuineFullChainSuccesses };
    `);
    expect(out.empty.classification).toBe("INCOMPLETE_SOURCE_PERIOD");
    expect(out.empty.eligible).toBe(false);
    expect(out.checkpointOnly.classification).toBe("ACQUISITION_NOT_PROVEN");
    expect(out.checkpointOnly.eligible).toBe(false);
    expect(out.full.classification).toBe("FULL_CHAIN_PROOF_SUCCESS");
    expect(out.full.eligible).toBe(true);
    expect(out.afterEmpty).toBe(0);
    expect(out.afterCk).toBe(0);
    expect(out.afterFull).toBe(1);
  });

  test("Ask NAC evidence answers differentiate freshness, join, mapping, and classification", () => {
    const out = run(`
      const q = mod.computeQuality({
        uniqueProducts: 137, mappedProducts: 84, itemRows: 5459, mappedItemRows: 4586,
        revenue: 100, mappedRevenue: 92, sessions: 1178, unclassifiedSessions: 16, joinPct: 1,
      });
      const published = {
        mix: { branchId: "khobar", periodStart: "2026-08-01", periodEnd: "2026-08-14", totalSessions: 1178, dessertFocusedShare: 0.536, foodContainingShare: 0.402, fullServiceShare: 0.122, dessertConversion: 0.304, byArchetype: {}, coversAvailable: true, source: "foodics" },
        evidence: mod.buildEvidenceSummary({ dataThrough: "2026-08-14", sessionsAnalyzed: 1178, quality: q, batchId: "commerce_batch_khobar_20260814_x" }),
        health: { dataThrough: "2026-08-14", lastIngestAt: "2026-08-15T00:00:00Z", status: "ready", quality: q },
        reconciliation: mod.reconcileHeadlineSales({ branchId: "khobar", businessDate: "2026-08-14", cashUpSales: 23836.52, foodicsSales: 23896.52, foodicsIncVat: 27412 }),
      };
      return {
        data: mod.answerPublishedCommerce("data_used", published),
        health: mod.answerPublishedCommerce("health", published),
        trust: mod.answerPublishedCommerce("trust", published),
        recon: mod.answerPublishedCommerce("reconciliation", published),
      };
    `);
    expect(out.data).toMatch(/classifiable/);
    expect(out.data).toMatch(/item rows/);
    expect(out.data).not.toMatch(/99% mapped/);
    expect(out.health).toMatch(/Latest complete commerce date: 2026-08-14/);
    expect(out.trust).toMatch(/Headline sales still come from Cash Up/);
    expect(out.recon).toMatch(/different things/);
    expect(out.recon).toMatch(/23836.52/);
  });
});
