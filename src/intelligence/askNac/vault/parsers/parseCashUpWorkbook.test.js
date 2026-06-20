import {
  excelSerialToIsoDate,
  parseCashUpWorkbookMatrices,
  resolveCashUpColumnMap,
  validateCashUpWorkbookParse,
} from "./parseCashUpWorkbook";

/** Pipe/chunk recovery layout (no spacer column after avg per guest). */
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

/** Production Cash up 2026.xlsx row (empty spacer column before Visa). */
const JUNE_17_XLSX_ROW = [
  "Wednesday",
  46190,
  20633,
  17941.73913,
  276,
  109,
  65.0063012,
  "",
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
  "",
  "",
  4227.83,
  2342.6,
  11371.30913,
];

const PRODUCTION_CASH_UP_HEADER = [
  "",
  "Date ",
  "Total Sales",
  "Net Total Sales",
  "Number of Guest",
  "Order Count",
  "Average per guest Gross",
  "",
  "Visa",
  "Cash",
  "Mastercard",
  "Mada",
  "Amex",
  "GCC-Net",
  "CCM Sales",
  "Jahez ",
  "No of order",
  "Chefz",
  "No of order",
  "Keeta",
  "No of order",
  "Hunger",
  "No of order",
  "Owners Account / On Account",
  "",
  "Tips",
  "Breakfast",
  "Lunch",
  "Dinner",
  "Discount/Comp Notes",
  "Discount/Comp/notes",
  "Void Count",
  "Void as No Waste",
  "Void Waste",
  "Fady ",
  "Comments",
];

const JUNE_17_EXPECTED = {
  gross_sales: 20633,
  net_sales: 17941.73913,
  cash_sales: 629,
  card_sales: 19046,
};

function expectJune17CoreMetrics(facts) {
  const june17 = facts.filter((fact) => fact.period_end === "2026-06-17");
  expect(june17.length).toBeGreaterThan(0);
  expect(june17.every((fact) => fact.period_end)).toBe(true);

  const metric = (key) => june17.find((fact) => fact.metric_key === key)?.metric_value;
  expect(metric("gross_sales")).toBe(JUNE_17_EXPECTED.gross_sales);
  expect(metric("net_sales")).toBe(JUNE_17_EXPECTED.net_sales);
  expect(metric("cash_sales")).toBe(JUNE_17_EXPECTED.cash_sales);
  expect(metric("card_sales")).toBe(JUNE_17_EXPECTED.card_sales);
}

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

function makeWeekRowXlsx(day, serial, gross, net, cash, visa, mastercard, mada, amex) {
  return [
    day,
    serial,
    gross,
    net,
    100,
    50,
    50,
    "",
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

  test("resolveCashUpColumnMap reads Visa/Cash from production header row", () => {
    const columnMap = resolveCashUpColumnMap([PRODUCTION_CASH_UP_HEADER]);
    expect(columnMap.visa).toBe(8);
    expect(columnMap.cash).toBe(9);
    expect(columnMap.mastercard).toBe(10);
    expect(columnMap.mada).toBe(11);
    expect(columnMap.amex).toBe(12);
  });

  test("parses June 17 chunk-recovery row with correct core metrics and period_end", () => {
    const matrix = [
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
    expectJune17CoreMetrics(result.facts);
  });

  test("parses June 17 production XLSX row with spacer column before Visa", () => {
    const matrix = [
      PRODUCTION_CASH_UP_HEADER,
      JUNE_17_XLSX_ROW,
      makeWeekRowXlsx("Thursday", 46191, 28184, 24507.82609, 1215, 8103.6, 2523.6, 15023.8, 134),
      makeWeekRowXlsx("Friday", 46192, 25901, 22522.6087, 546, 8339, 1676, 14278, 0),
      makeWeekRowXlsx("Saturday", 46189, 14090, 12252.17391, 769, 4021, 2018, 6315, 0),
      makeWeekRowXlsx("Sunday", 46188, 13645, 11865.21739, 603, 4366, 1431, 6006, 0),
      makeWeekRowXlsx("Monday", 46186, 19129, 16633.91304, 1704, 4483, 2288, 9626, 400),
    ];

    const result = parseCashUpWorkbookMatrices([matrix]);
    expect(result.ok).toBe(true);
    expect(validateCashUpWorkbookParse(result)).toBe(true);
    expectJune17CoreMetrics(result.facts);
  });

  test("June 17 guard: gross_sales, net_sales, cash_sales, card_sales", () => {
    const result = parseCashUpWorkbookMatrices([
      [
        PRODUCTION_CASH_UP_HEADER,
        JUNE_17_XLSX_ROW,
        makeWeekRowXlsx("Thursday", 46191, 28184, 24507.82609, 1215, 8103.6, 2523.6, 15023.8, 134),
        makeWeekRowXlsx("Friday", 46192, 25901, 22522.6087, 546, 8339, 1676, 14278, 0),
        makeWeekRowXlsx("Saturday", 46189, 14090, 12252.17391, 769, 4021, 2018, 6315, 0),
        makeWeekRowXlsx("Sunday", 46188, 13645, 11865.21739, 603, 4366, 1431, 6006, 0),
        makeWeekRowXlsx("Monday", 46186, 19129, 16633.91304, 1704, 4483, 2288, 9626, 400),
      ],
    ]);
    expect(result.ok).toBe(true);
    expectJune17CoreMetrics(result.facts);
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

  test("cash_up XLSX uses workbook parser before atomic RPC replace", () => {
    expect(driveHelper).toMatch(/parseCashUpWorkbookFromXlsxBuffer/);
    expect(driveHelper).toMatch(/if \(!validateCashUpWorkbookParse\(parsed\)\)/);
    expect(driveHelper).toMatch(/existing facts preserved/);
    expect(driveHelper).toMatch(/replaceStructuredFactsForFile/);
    expect(driveHelper).not.toMatch(/await admin\.from\("ask_nac_structured_facts"\)\.delete\(\)\.eq\("file_id"/);
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
