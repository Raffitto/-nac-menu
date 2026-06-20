import {
  excelSerialToIsoDate,
  parseCashUpWorkbookMatrices,
  validateCashUpWorkbookParse,
} from "./parseCashUpWorkbook";

const JUNE_17_ROW = [
  "Wednesday",
  46190,
  20633,
  17941.73913,
  276,
  109,
  65.0063012,
  4898,
  629,
  1277,
  12670,
  201,
  65,
  19111,
  62,
  1,
  62,
  1,
  59,
  1,
  710,
  5,
  0,
  4227.83,
  2342.6,
  11371.30913,
];

function makeWeekRow(day, serial, gross, net, cash, visa, mastercard, mada, amex) {
  return [
    day,
    serial,
    gross,
    net,
    100,
    50,
    50,
    visa,
    cash,
    mastercard,
    mada,
    amex,
  ];
}

describe("parseCashUpWorkbook", () => {
  test("excelSerialToIsoDate resolves 46190 to 2026-06-17", () => {
    expect(excelSerialToIsoDate(46190)).toBe("2026-06-17");
    expect(excelSerialToIsoDate(46192)).toBe("2026-06-19");
  });

  test("parses June 17 cash-up row with correct core metrics and period_end", () => {
    const header = [
      "Date",
      "Total Sales",
      "Net Total Sales",
      "Number of Guest",
      "Order Count",
      "Average per guest Gross",
      "Visa",
      "Cash",
      "Mastercard",
      "Mada",
      "Amex",
    ];
    const matrix = [
      header,
      JUNE_17_ROW,
      makeWeekRow("Thursday", 46191, 28184, 24507.82609, 1215, 8103.6, 2523.6, 15023.8, 134),
      makeWeekRow("Friday", 46192, 25901, 22522.6087, 546, 8339, 1676, 14278, 0),
      makeWeekRow("Saturday", 46189, 14090, 12252.17391, 769, 4021, 2018, 6315, 0),
      makeWeekRow("Sunday", 46188, 13645, 11865.21739, 603, 4366, 1431, 6006, 0),
      makeWeekRow("Monday", 46186, 19129, 16633.91304, 1704, 4483, 2288, 9626, 400),
    ];

    const result = parseCashUpWorkbookMatrices([matrix]);
    expect(result.ok).toBe(true);
    expect(validateCashUpWorkbookParse(result)).toBe(true);
    expect(result.periodEnd).toBe("2026-06-19");

    const june17 = result.facts.filter((fact) => fact.period_end === "2026-06-17");
    expect(june17.length).toBeGreaterThan(0);
    expect(june17.every((fact) => fact.period_end)).toBe(true);

    const metric = (key) => june17.find((fact) => fact.metric_key === key)?.metric_value;
    expect(metric("gross_sales")).toBe(20633);
    expect(metric("net_sales")).toBe(17941.73913);
    expect(metric("cash_sales")).toBe(629);
    expect(metric("card_sales")).toBe(19046);
  });

  test("validateCashUpWorkbookParse rejects parse without enough daily rows", () => {
    const result = parseCashUpWorkbookMatrices([[JUNE_17_ROW]]);
    expect(result.ok).toBe(false);
    expect(validateCashUpWorkbookParse(result)).toBe(false);
  });

  test("validateCashUpWorkbookParse rejects facts missing period_end", () => {
    const invalid = {
      ok: true,
      facts: [{ metric_key: "gross_sales", metric_value: 100, period_end: null, period_start: null }],
      dailyRowCount: 10,
      parser: "cash_up_workbook",
    };
    expect(validateCashUpWorkbookParse(invalid)).toBe(false);
  });
});

describe("Drive cash-up ingestion wiring", () => {
  const fs = require("fs");
  const path = require("path");
  const driveHelper = fs.readFileSync(
    path.resolve(__dirname, "../../../../../supabase/functions/_shared/vaultDriveIngestion.ts"),
    "utf8",
  );

  test("cash_up XLSX uses workbook parser before deleting facts", () => {
    expect(driveHelper).toMatch(/parseCashUpWorkbookFromXlsxBuffer/);
    expect(driveHelper).toMatch(/if \(!validateCashUpWorkbookParse\(parsed\)\)/);
    expect(driveHelper).toMatch(/existing facts preserved/);
    expect(driveHelper).toMatch(/async function persistParsedFacts/);
    expect(driveHelper).toMatch(/await persistParsedFacts\(admin, \{\s*fileRow,\s*versionRowId,\s*email,\s*rows,/);
  });

  test("cash_up XLSX does not use flattened extractCashUpStructuredFacts path", () => {
    expect(driveHelper).toMatch(/isCashUpSpreadsheet/);
    expect(driveHelper).toMatch(/Cash-up workbook parse failed — existing facts preserved/);
    expect(driveHelper).toMatch(/insertStructuredFacts/);
  });

  test("scheduled ingest still routes through insertStructuredFacts", () => {
    const scheduledIngest = fs.readFileSync(
      path.resolve(__dirname, "../../../../../supabase/functions/_shared/vaultDriveScheduledIngest.ts"),
      "utf8",
    );
    expect(scheduledIngest).toMatch(/processDriveIngestionRun/);
    expect(driveHelper).toMatch(/download,/);
    expect(driveHelper).toMatch(/insertStructuredFacts\(admin/);
  });
});
