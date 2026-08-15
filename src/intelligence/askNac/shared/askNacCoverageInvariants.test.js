/**
 * Calendar completion vs missing completed days.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const REF = "new Date('2026-08-15T12:00:00.000Z')";

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

describe("coverage calendar invariants", () => {
  test("A. today incomplete is not a missing completed day", () => {
    const out = run(`
      const ref = ${REF};
      const cal = mod.classifyCalendarCoverage({
        requestedStart: "2026-08-15",
        requestedEnd: "2026-08-15",
        observedDays: 0,
        referenceDate: ref,
      });
      const t = mod.resolveTurnSemantics({ question: "How are we doing today?", branchHint: "khobar", referenceDate: ref });
      const text = mod.synthesizeDeterministicAnswer({
        question: "How are we doing today?",
        branchId: "khobar",
        period: t.period,
        evidence: [],
        claims: [],
        coverage: [mod.buildCoverageReport({ domain: "sales", range: t.period, expectedRecords: 1, availableRecords: 0 })],
        primaryMetric: "sales",
      });
      return { status: cal.status, missing: cal.missingCompletedDays, incomplete: cal.currentIncompleteDays, text };
    `);
    expect(out.status).toBe("today_incomplete");
    expect(out.missing == null || out.missing === 0).toBe(true);
    expect(out.text).toMatch(/not available yet/i);
    expect(out.text).not.toMatch(/missing/i);
  });

  test("B. yesterday missing is named missing", () => {
    const out = run(`
      const ref = ${REF};
      const t = mod.resolveTurnSemantics({ question: "How did we do yesterday?", branchHint: "khobar", referenceDate: ref });
      const text = mod.synthesizeDeterministicAnswer({
        question: "How did we do yesterday?",
        branchId: "khobar",
        period: t.period,
        evidence: [],
        claims: [],
        coverage: [mod.buildCoverageReport({ domain: "sales", range: t.period, expectedRecords: 1, availableRecords: 0 })],
        primaryMetric: "sales",
      });
      return { start: t.period?.startDate, text };
    `);
    expect(out.start).toBe("2026-08-14");
    expect(out.text).toMatch(/not yet available/i);
    expect(out.text).not.toMatch(/latest completed business day is Friday, 14 August and that is the answer/i);
  });

  test("C. MTD through yesterday does not count today as missing", () => {
    const out = run(`
      const ref = ${REF};
      const t = mod.resolveTurnSemantics({ question: "How are we doing this month?", branchHint: "khobar", referenceDate: ref });
      const dates = [];
      for (let d = 1; d <= 14; d++) dates.push("2026-08-" + String(d).padStart(2, "0"));
      const cal = mod.classifyCalendarCoverage({
        requestedStart: t.period.startDate,
        requestedEnd: t.period.endDate,
        observedDates: dates,
        referenceDate: ref,
      });
      const text = mod.synthesizeDeterministicAnswer({
        question: "How are we doing this month?",
        branchId: "khobar",
        period: t.period,
        evidence: [
          mod.createEvidence({ source: "cash_up", domain: "INTERNAL_STRUCTURED", branchId: "khobar", metricOrEvent: "net_sales", value: 100, textSummary: "sales", period: t.period }),
        ],
        claims: [],
        coverage: [mod.buildCoverageReport({ domain: "sales", range: t.period, expectedRecords: 14, availableRecords: 14 })],
        primaryMetric: "sales",
        ranking: "top",
        rankingCount: 3,
        dailyFacts: dates.map((date) => ({ date, net_sales: 10000, covers: 100, orders: 40, avg_spend: 100 })),
      });
      return { end: t.period.endDate, missing: cal.missingCompletedDays, status: cal.status, through: mod.formatThroughPeriod(t.period, ref), text };
    `);
    expect(out.end).toBe("2026-08-14");
    expect(out.missing).toBe(0);
    expect(out.through).toMatch(/August through 14 August/);
    expect(out.text).not.toMatch(/14\/15/);
    expect(out.text).not.toMatch(/1 missing/i);
  });

  test("D. historical missing completed day is disclosed", () => {
    const out = run(`
      const ref = ${REF};
      const cal = mod.classifyCalendarCoverage({
        requestedStart: "2026-08-01",
        requestedEnd: "2026-08-14",
        observedDays: 13,
        referenceDate: ref,
      });
      return cal;
    `);
    expect(out.status).toBe("missing_completed_days");
    expect(out.missingCompletedDays).toBe(1);
  });

  test("G. ranking ranks only completed observed days", () => {
    const out = run(`
      const ref = ${REF};
      const t = mod.resolveTurnSemantics({ question: "Best 3 sales days this month", branchHint: "khobar", referenceDate: ref });
      const facts = [];
      for (let d = 1; d <= 15; d++) {
        facts.push({ date: "2026-08-" + String(d).padStart(2, "0"), net_sales: d === 15 ? 999999 : 10000 + d, covers: 100, orders: 40, avg_spend: 100 });
      }
      const text = mod.synthesizeDeterministicAnswer({
        question: "Best 3 sales days this month",
        branchId: "khobar",
        period: t.period,
        evidence: [],
        claims: [],
        coverage: [mod.buildCoverageReport({ domain: "sales", range: t.period, expectedRecords: 14, availableRecords: 14 })],
        primaryMetric: "sales",
        ranking: "top",
        rankingCount: 3,
        dailyFacts: facts,
      });
      return { text, end: t.period.endDate };
    `);
    expect(out.text).not.toMatch(/15 August/);
    expect(out.text).not.toMatch(/14\/15/);
  });
});
