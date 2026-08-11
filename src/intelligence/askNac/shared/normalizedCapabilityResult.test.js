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
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(stdout.trim());
}

describe("Normalized capability results", () => {
  test("Cash Up overview and alternate aggregate shapes normalize to same metric keys", () => {
    const out = run(`
      const period = { startDate: "2026-08-01", endDate: "2026-08-10", label: "Aug MTD" };
      const a = mod.normalizeCapabilityResult({
        capabilityId: "commercial.performance",
        implementationTool: "cash_up_performance",
        branchId: "khobar",
        requestedPeriod: period,
        raw: {
          facts: [
            { metric_key: "net_sales", metric_value: 100000, unit: "SAR" },
            { metric_key: "covers", metric_value: 1200 },
          ],
          coverage: { expectedDays: 10, availableDays: 10, freshness: "2026-08-10" },
        },
      });
      const b = mod.normalizeCapabilityResult({
        capabilityId: "commercial.performance",
        implementationTool: "cash_up_performance",
        branchId: "khobar",
        requestedPeriod: period,
        raw: {
          aggregated: { net_sales: 100000, covers: 1200 },
          matchedCoverage: { expectedRecords: 10, availableRecords: 10, freshness: "2026-08-10" },
        },
      });
      return {
        aKeys: a.metrics.map((m) => m.metricKey).sort(),
        bKeys: b.metrics.map((m) => m.metricKey).sort(),
        aSales: a.metrics.find((m) => m.metricKey === "net_sales").value,
        bSales: b.metrics.find((m) => m.metricKey === "net_sales").value,
        aAuth: a.sourceAuthority,
        bAuth: b.sourceAuthority,
        aCov: a.coverage.coverageRatio,
        bCov: b.coverage.coverageRatio,
      };
    `);
    expect(out.aKeys).toEqual(out.bKeys);
    expect(out.aSales).toBe(100000);
    expect(out.bSales).toBe(100000);
    expect(out.aAuth).toBe("CANONICAL_STRUCTURED");
    expect(out.bAuth).toBe("CANONICAL_STRUCTURED");
    expect(out.aCov).toBe(1);
    expect(out.bCov).toBe(1);
  });

  test("Cash Up compare normalizes mode + percentChange from legacy fields", () => {
    const out = run(`
      const n = mod.normalizeCapabilityResult({
        capabilityId: "commercial.compare",
        implementationTool: "cash_up_compare",
        branchId: "khobar",
        requestedPeriod: { startDate: "2026-08-04", endDate: "2026-08-10" },
        comparisonPeriod: { startDate: "2026-07-28", endDate: "2026-08-03" },
        methodHint: "matched_days",
        raw: {
          comparison: {
            deltaPct: -5.6,
            matchedDayCount: 8,
            method: "matched_days",
            current: { startDate: "2026-08-04", endDate: "2026-08-10", netSales: 90000 },
            previous: { startDate: "2026-07-28", endDate: "2026-08-03", netSales: 95400 },
          },
          coverage: { expectedDays: 10, availableDays: 8 },
        },
      });
      return {
        mode: n.comparison.mode,
        pct: n.comparison.percentChange,
        matched: n.comparison.matchedDayCount,
        ratio: n.coverage.coverageRatio,
        warnings: n.warnings,
      };
    `);
    expect(out.mode).toBe("matched_days");
    expect(out.pct).toBe(-5.6);
    expect(out.matched).toBe(8);
    expect(out.ratio).toBe(0.8);
    expect(out.warnings).toEqual(expect.arrayContaining(["partial_coverage", "like_for_like"]));
  });

  test("day ranking normalizes ranking rows", () => {
    const out = run(`
      const n = mod.normalizeCapabilityResult({
        capabilityId: "commercial.rank_days",
        implementationTool: "cash_up_day_ranking",
        branchId: "khobar",
        requestedPeriod: { startDate: "2026-08-01", endDate: "2026-08-10" },
        raw: {
          dayRanking: [
            { rank: 1, direction: "worst", date: "2026-08-03", net_sales: 4200 },
            { rank: 1, direction: "best", date: "2026-08-09", net_sales: 18000 },
          ],
        },
      });
      return {
        count: n.rankings.length,
        worst: n.rankings.find((r) => r.direction === "bottom"),
        best: n.rankings.find((r) => r.direction === "top"),
      };
    `);
    expect(out.count).toBe(2);
    expect(out.worst.value).toBe(4200);
    expect(out.best.value).toBe(18000);
  });

  test("operational/logbook normalizes concise qualitative evidence without giant blobs", () => {
    const out = run(`
      const giant = "x".repeat(5000);
      const n = mod.normalizeCapabilityResult({
        capabilityId: "operations.review",
        implementationTool: "operational_evidence",
        branchId: "khobar",
        requestedPeriod: { startDate: "2026-08-04", endDate: "2026-08-10" },
        raw: {
          documents: [
            { id: "doc1", summary: giant, document_id: "lb-1", date: "2026-08-05" },
          ],
          issues: [{ id: "i1", text: "Weak walk-ins Sunday", relevance: "high" }],
          coverage: { expectedDays: 7, availableDays: 5 },
        },
      });
      return {
        source: n.source,
        auth: n.sourceAuthority,
        summaries: n.qualitativeEvidence.map((q) => q.summary.length),
        refs: n.qualitativeEvidence.map((q) => q.documentRef),
        maxLen: Math.max(...n.qualitativeEvidence.map((q) => q.summary.length)),
      };
    `);
    expect(out.source).toBe("logbook");
    expect(out.auth).toBe("OPERATIONAL_RECORDED_EVIDENCE");
    expect(out.maxLen).toBeLessThanOrEqual(280);
    expect(out.refs).toContain("lb-1");
  });

  test("partial coverage and unavailable source normalize consistently", () => {
    const out = run(`
      const partial = mod.normalizeCoverageFromUnknown(
        { expectedDays: 10, availableDays: 8 },
        { startDate: "2026-08-01", endDate: "2026-08-10" },
      );
      const unavailable = mod.normalizeCapabilityResult({
        capabilityId: "staff.performance",
        implementationTool: "staff_performance",
        skipped: true,
        skipReason: "staff_source_unavailable",
        branchId: "khobar",
        requestedPeriod: { startDate: "2026-08-01", endDate: "2026-08-10" },
        textSnippets: ["Staff-performance evidence is not available for this request."],
        coverage: mod.buildCoverageReport({
          domain: "staff",
          range: { startDate: "2026-08-01", endDate: "2026-08-10" },
          expectedRecords: 1,
          availableRecords: 0,
        }),
      });
      const notComparable = mod.normalizeComparisonFromUnknown(null, {
        statusHint: "not_comparable",
        requestedCurrent: { startDate: "2026-02-18", endDate: "2026-03-19" },
        requestedPrevious: { startDate: "2025-03-01", endDate: "2025-03-29" },
      });
      return {
        partialRatio: partial.coverageRatio,
        missing: partial.missingDays,
        unavailableSkipped: unavailable.provenance.skipped,
        unavailableAuth: unavailable.sourceAuthority,
        mode: notComparable.mode,
        pctNull: notComparable.percentChange,
      };
    `);
    expect(out.partialRatio).toBe(0.8);
    expect(out.missing).toBe(2);
    expect(out.unavailableSkipped).toBe(true);
    expect(out.mode).toBe("not_comparable");
    expect(out.pctNull).toBeNull();
  });

  test("orchestration stores normalized comparison/coverage in toolResults", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Are we doing better than the week before?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
      });
      const compare = result.state.toolResults["commercial.compare"] || result.state.toolResults["commercial.performance"];
      return {
        hasNormalizedComparison: Boolean(compare?.comparison || compare?.coverage),
        paid: result.paidModelCalls,
        stage: result.state.stage,
      };
    `);
    expect(out.stage).toBe("COMPLETE");
    expect(out.hasNormalizedComparison).toBe(true);
    expect(out.paid).toBe(0);
  });
});
