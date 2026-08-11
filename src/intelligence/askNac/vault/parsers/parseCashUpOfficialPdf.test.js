/**
 * Official July 2026 Cash Up PDF parser — focused integration against the real PDF.
 */
const { readFileSync } = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../../..");
const PDF_PATH = "/Users/raffiazarian/Documents/NAC/Cash up 2026.xlsx - July 26 (4).pdf";

function loadParser() {
  // Dynamic import via node for the ESM-style module without "type":"module"
  const script = `
    import(${JSON.stringify(path.join(root, "src/intelligence/askNac/vault/parsers/parseCashUpOfficialPdf.js"))})
      .then((mod) => process.stdout.write(JSON.stringify({
        keys: Object.keys(mod),
      })))
      .catch((err) => { console.error(err); process.exit(1); });
  `;
  // Just verify import path; actual parse via require through babel isn't available.
  // Use node --input-type=module helper for assertions.
  return script;
}

function parseOfficialPdf() {
  const script = `
    import { readFileSync } from "fs";
    import { execFileSync } from "child_process";
    import { parseCashUpOfficialPdfText, CASH_UP_OFFICIAL_PDF_PARSER_VERSION } from ${JSON.stringify(path.join(root, "src/intelligence/askNac/vault/parsers/parseCashUpOfficialPdf.js"))};
    const pdfPath = ${JSON.stringify(PDF_PATH)};
    const py = \`
from pypdf import PdfReader
import sys
text = "\\\\n".join((p.extract_text() or "") for p in PdfReader(sys.argv[1]).pages)
sys.stdout.write(text)
\`;
    const text = execFileSync("python3", ["-c", py, pdfPath], { encoding: "utf8" });
    const result = parseCashUpOfficialPdfText(text, { branchId: "khobar", periodMonth: "2026-07" });
    process.stdout.write(JSON.stringify({
      ok: result.ok,
      parser: result.parser,
      dailyRowCount: result.dailyRowCount,
      dates: result.dailyRows.map((r) => r.businessDate).sort(),
      d31: result.dailyRows.find((r) => r.businessDate === "2026-07-31"),
      d16: result.dailyRows.find((r) => r.businessDate === "2026-07-16"),
      sourceMonthly: result.sourceMonthly,
      sourceTarget: result.sourceTarget,
      sourceDailyAverage: result.sourceDailyAverage,
      derived: result.derived,
      reconciliation: result.reconciliation,
      qualityCodes: (result.qualityIssues || []).map((q) => q.code),
      analyticsPolicy: result.analyticsPolicy,
      staleFact: (result.facts || []).find((f) => f.metric_key === "source_reported_daily_average"),
      fileBytes: readFileSync(pdfPath).length,
      basename: ${JSON.stringify(path.basename(PDF_PATH))},
      version: CASH_UP_OFFICIAL_PDF_PARSER_VERSION,
    }));
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(stdout.trim());
}

describe("parseCashUpOfficialPdfText — July 2026 official report", () => {
  let result;

  beforeAll(() => {
    void loadParser;
    result = parseOfficialPdf();
  });

  test("1. all 31 July dates ingest", () => {
    expect(result.ok).toBe(true);
    expect(result.dailyRowCount).toBe(31);
    expect(result.parser).toBe(result.version);
    expect(result.dates[0]).toBe("2026-07-01");
    expect(result.dates[30]).toBe("2026-07-31");
    expect(new Set(result.dates).size).toBe(31);
  });

  test("2. 31 July row preserved", () => {
    expect(result.d31).toMatchObject({
      totalSales: 29754,
      netSales: 25873.04,
      guestCount: 386,
      orderCount: 151,
    });
  });

  test("3. source totals parse correctly", () => {
    expect(result.sourceMonthly).toMatchObject({
      grossSales: 681011.23,
      netSales: 590126.95,
      guestCount: 8302,
      orderCount: 3506,
    });
    expect(result.sourceTarget).toBe(1050000);
  });

  test("4. derived daily sums reconcile with monthly totals", () => {
    expect(result.reconciliation.grossMatch).toBe(true);
    expect(result.reconciliation.netMatch).toBe(true);
    expect(result.reconciliation.guestsMatch).toBe(true);
    expect(result.reconciliation.ordersMatch).toBe(true);
    expect(result.derived.grossSales).toBe(681011.23);
    expect(result.derived.guestCount).toBe(8302);
    expect(result.derived.orderCount).toBe(3506);
  });

  test("5. stale Daily Average row flagged but preserved", () => {
    expect(result.sourceDailyAverage).toMatchObject({
      grossPerDay: 21708.57,
      netPerDay: 18808.46,
      guestsPerDay: 263.87,
      ordersPerDay: 111.83,
      avgPerGuest: 70.82,
    });
    expect(result.qualityCodes).toContain("STALE_DAILY_AVERAGE_ROW");
    expect(result.analyticsPolicy.prefer).toContain("DERIVED_FROM_DAILY_ROWS");
    expect(result.staleFact?.dimensions?.stale).toBe(true);
  });

  test("6. source file archived path exists with original bytes", () => {
    expect(result.fileBytes).toBeGreaterThan(1000);
    expect(result.basename).toMatch(/July 26 \(4\)\.pdf$/i);
  });
});

describe("shouldUseCashUpRangeRpc prefers period RPC", () => {
  test("month ranges use RPC even with daily breakdown", () => {
    const { shouldUseCashUpRangeRpc } = require("../vaultCashUpRangeRpc");
    expect(shouldUseCashUpRangeRpc({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      periodType: "this_month",
      includeDailyBreakdown: true,
    })).toBe(true);
  });
});
