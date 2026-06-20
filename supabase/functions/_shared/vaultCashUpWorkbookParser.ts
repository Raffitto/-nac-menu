/**
 * Cash-up workbook row parser for Drive ingestion (Excel serial daily rows).
 * Handles NAC horizontal cash-up tables: weekday | serial | Total Sales | Net Total Sales | ...
 */

export type CashUpWorkbookFact = {
  metric_key: string;
  metric_value: number | null;
  dimensions: Record<string, unknown>;
  period_start: string;
  period_end: string;
  grain: string;
  source_row_ref: string;
  confidence: number;
};

export type CashUpWorkbookParseResult = {
  ok: boolean;
  error: string | null;
  facts: CashUpWorkbookFact[];
  dailyRowCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  parser: "cash_up_workbook";
};

const WEEKDAYS = new Set([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

const EXCEL_SERIAL_MIN = 45000;
const EXCEL_SERIAL_MAX = 47000;
const MIN_DAILY_ROWS = 5;

export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const wholeDays = Math.floor(serial);
  const epochMs = Date.UTC(1899, 11, 30);
  const dateMs = epochMs + wholeDays * 86400000;
  const d = new Date(dateMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseNumericCell(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw ?? "").trim();
  if (!text || !/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function optionalNumericCell(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  return parseNumericCell(raw);
}

type CashUpColumnMap = {
  visa: number;
  cash: number;
  mastercard: number;
  mada: number;
  amex: number;
  ccm: number;
  jahez: number;
  chefz: number;
  keeta: number;
  hunger: number;
  breakfast: number;
  lunch: number;
  dinner: number;
  discounts: number;
  voidCount: number;
  voids: number;
};

/** Pipe/chunk layout (no spacer columns between avg per guest and Visa). */
const LEGACY_CASH_UP_COLUMN_MAP: CashUpColumnMap = {
  visa: 7,
  cash: 8,
  mastercard: 9,
  mada: 10,
  amex: 11,
  ccm: 13,
  jahez: 14,
  chefz: 15,
  keeta: 16,
  hunger: 17,
  breakfast: 19,
  lunch: 20,
  dinner: 21,
  discounts: 23,
  voidCount: 24,
  voids: 25,
};

function normalizeHeaderLabel(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findHeaderIndex(labels: string[], predicate: (label: string) => boolean): number {
  const index = labels.findIndex(predicate);
  return index >= 0 ? index : -1;
}

export function resolveCashUpColumnMap(matrix: unknown[][]): CashUpColumnMap {
  for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 40); rowIndex += 1) {
    const row = matrix[rowIndex];
    if (!Array.isArray(row)) continue;

    const labels = row.map(normalizeHeaderLabel);
    const visa = findHeaderIndex(labels, (label) => label === "visa");
    const cash = findHeaderIndex(labels, (label) => label === "cash");
    const totalSales = findHeaderIndex(
      labels,
      (label) => label.includes("total sales") && !label.includes("net"),
    );
    if (visa < 0 || cash < 0 || totalSales < 0) continue;

    return {
      visa,
      cash,
      mastercard: findHeaderIndex(labels, (label) => label === "mastercard"),
      mada: findHeaderIndex(labels, (label) => label === "mada"),
      amex: findHeaderIndex(labels, (label) => label === "amex"),
      ccm: findHeaderIndex(labels, (label) => label.includes("ccm")),
      jahez: findHeaderIndex(labels, (label) => label.includes("jahez")),
      chefz: findHeaderIndex(labels, (label) => label === "chefz"),
      keeta: findHeaderIndex(labels, (label) => label === "keeta"),
      hunger: findHeaderIndex(labels, (label) => label === "hunger"),
      breakfast: findHeaderIndex(labels, (label) => label === "breakfast"),
      lunch: findHeaderIndex(labels, (label) => label === "lunch"),
      dinner: findHeaderIndex(labels, (label) => label === "dinner"),
      discounts: findHeaderIndex(labels, (label) => label.includes("discount")),
      voidCount: findHeaderIndex(labels, (label) => label.includes("void count")),
      voids: findHeaderIndex(
        labels,
        (label) => label.includes("void waste") || label === "void as no waste",
      ),
    };
  }

  return LEGACY_CASH_UP_COLUMN_MAP;
}

function columnIndex(columnMap: CashUpColumnMap, key: keyof CashUpColumnMap): number {
  const index = columnMap[key];
  return index >= 0 ? index : LEGACY_CASH_UP_COLUMN_MAP[key];
}

type ParsedDailyRow = {
  businessDate: string;
  sourceRowRef: string;
  totalSales: number;
  netSales: number;
  guestCount: number | null;
  orderCount: number | null;
  avgPerGuest: number | null;
  visaSales: number | null;
  cashSales: number | null;
  mastercardSales: number | null;
  madaSales: number | null;
  amexSales: number | null;
  ccmSales: number | null;
  jahezSales: number | null;
  chefzSales: number | null;
  keetaSales: number | null;
  hungerSales: number | null;
  breakfastSales: number | null;
  lunchSales: number | null;
  dinnerSales: number | null;
  discounts: number | null;
  voidCount: number | null;
  voids: number | null;
};

function parseDailyRow(
  row: unknown[],
  sourceRowRef: string,
  columnMap: CashUpColumnMap,
): ParsedDailyRow | null {
  if (!Array.isArray(row) || row.length < 4) return null;
  const day = String(row[0] ?? "").trim().toLowerCase();
  if (!WEEKDAYS.has(day)) return null;

  const serial = parseNumericCell(row[1]);
  if (serial == null || serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) return null;

  const totalSales = parseNumericCell(row[2]);
  const netSales = parseNumericCell(row[3]);
  if (totalSales == null || netSales == null) return null;

  const businessDate = excelSerialToIsoDate(serial);
  if (!businessDate) return null;

  return {
    businessDate,
    sourceRowRef,
    totalSales,
    netSales,
    guestCount: optionalNumericCell(row[4]),
    orderCount: optionalNumericCell(row[5]),
    avgPerGuest: optionalNumericCell(row[6]),
    visaSales: optionalNumericCell(row[columnIndex(columnMap, "visa")]),
    cashSales: optionalNumericCell(row[columnIndex(columnMap, "cash")]),
    mastercardSales: optionalNumericCell(row[columnIndex(columnMap, "mastercard")]),
    madaSales: optionalNumericCell(row[columnIndex(columnMap, "mada")]),
    amexSales: optionalNumericCell(row[columnIndex(columnMap, "amex")]),
    ccmSales: optionalNumericCell(row[columnIndex(columnMap, "ccm")]),
    jahezSales: optionalNumericCell(row[columnIndex(columnMap, "jahez")]),
    chefzSales: optionalNumericCell(row[columnIndex(columnMap, "chefz")]),
    keetaSales: optionalNumericCell(row[columnIndex(columnMap, "keeta")]),
    hungerSales: optionalNumericCell(row[columnIndex(columnMap, "hunger")]),
    breakfastSales: optionalNumericCell(row[columnIndex(columnMap, "breakfast")]),
    lunchSales: optionalNumericCell(row[columnIndex(columnMap, "lunch")]),
    dinnerSales: optionalNumericCell(row[columnIndex(columnMap, "dinner")]),
    discounts: optionalNumericCell(row[columnIndex(columnMap, "discounts")]),
    voidCount: optionalNumericCell(row[columnIndex(columnMap, "voidCount")]),
    voids: optionalNumericCell(row[columnIndex(columnMap, "voids")]),
  };
}

function buildFactsForDailyRow(row: ParsedDailyRow): CashUpWorkbookFact[] {
  const facts: CashUpWorkbookFact[] = [];
  const base = {
    period_start: row.businessDate,
    period_end: row.businessDate,
    grain: "daily",
    source_row_ref: row.sourceRowRef,
    confidence: 0.78,
  };

  const add = (metricKey: string, metricValue: number | null, dimensions: Record<string, unknown> = {}) => {
    if (metricKey !== "business_date" && metricValue == null) return;
    facts.push({
      metric_key: metricKey,
      metric_value: metricValue,
      dimensions,
      ...base,
    });
  };

  add("business_date", null, { text_value: row.businessDate });
  add("total_sales", row.totalSales);
  add("gross_sales", row.totalSales);
  add("net_sales", row.netSales);
  add("guest_count", row.guestCount);
  add("covers", row.guestCount);
  add("order_count", row.orderCount);
  add("avg_per_guest", row.avgPerGuest);
  add("cash_sales", row.cashSales);
  add(
    "card_sales",
    (row.visaSales ?? 0) + (row.mastercardSales ?? 0) + (row.madaSales ?? 0) + (row.amexSales ?? 0),
  );
  add("payment_method", row.cashSales, { method: "cash" });
  add("payment_method", row.visaSales, { method: "visa" });
  add("payment_method", row.mastercardSales, { method: "mastercard" });
  add("payment_method", row.madaSales, { method: "mada" });
  add("payment_method", row.amexSales, { method: "amex" });
  add(
    "delivery_sales",
    (row.jahezSales ?? 0) + (row.chefzSales ?? 0) + (row.keetaSales ?? 0) + (row.hungerSales ?? 0),
  );
  add("delivery_sales", row.jahezSales, { platform: "jahez" });
  add("delivery_sales", row.chefzSales, { platform: "chefz" });
  add("delivery_sales", row.keetaSales, { platform: "keeta" });
  add("delivery_sales", row.hungerSales, { platform: "hunger" });
  add("ccm_sales", row.ccmSales);
  add("breakfast_sales", row.breakfastSales);
  add("lunch_sales", row.lunchSales);
  add("dinner_sales", row.dinnerSales);
  add("discounts", row.discounts);
  add("void_count", row.voidCount);
  add("voids", row.voids);

  return facts;
}

export function parseCashUpWorkbookMatrices(matrices: unknown[][][]): CashUpWorkbookParseResult {
  const dailyRows: ParsedDailyRow[] = [];

  matrices.forEach((matrix, sheetIndex) => {
    const columnMap = resolveCashUpColumnMap(matrix || []);
    (matrix || []).forEach((row, rowIndex) => {
      const parsed = parseDailyRow(
        row as unknown[],
        `sheet-${sheetIndex + 1}-row-${rowIndex + 1}`,
        columnMap,
      );
      if (parsed) dailyRows.push(parsed);
    });
  });

  if (dailyRows.length < MIN_DAILY_ROWS) {
    return {
      ok: false,
      error: `Cash-up workbook parse found ${dailyRows.length} daily rows (minimum ${MIN_DAILY_ROWS}).`,
      facts: [],
      dailyRowCount: dailyRows.length,
      periodStart: null,
      periodEnd: null,
      parser: "cash_up_workbook",
    };
  }

  const facts = dailyRows.flatMap((row) => buildFactsForDailyRow(row));
  const dates = dailyRows.map((row) => row.businessDate).sort();
  const periodStart = dates[0] || null;
  const periodEnd = dates[dates.length - 1] || null;

  if (!facts.length || facts.some((fact) => !fact.period_end)) {
    return {
      ok: false,
      error: "Cash-up workbook parse produced facts without period_end.",
      facts: [],
      dailyRowCount: dailyRows.length,
      periodStart,
      periodEnd,
      parser: "cash_up_workbook",
    };
  }

  return {
    ok: true,
    error: null,
    facts,
    dailyRowCount: dailyRows.length,
    periodStart,
    periodEnd,
    parser: "cash_up_workbook",
  };
}

export async function parseCashUpWorkbookFromXlsxBuffer(buffer: ArrayBuffer): Promise<CashUpWorkbookParseResult> {
  const XLSX = await import("npm:xlsx@0.18.5");
  const workbook = XLSX.read(buffer, { type: "array" });
  const matrices = workbook.SheetNames.map((sheetName: string) => {
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  });
  return parseCashUpWorkbookMatrices(matrices);
}

export function validateCashUpWorkbookParse(result: CashUpWorkbookParseResult): boolean {
  if (!result.ok || !result.facts.length) return false;
  if (result.dailyRowCount < MIN_DAILY_ROWS) return false;
  if (result.facts.some((fact) => !fact.period_end)) return false;
  return true;
}

export function attachCashUpWorkbookFactContext(
  facts: CashUpWorkbookFact[],
  fileRow: Record<string, unknown>,
  versionRowId: string | null,
  email: string,
) {
  return facts.map((fact) => ({
    file_id: fileRow.id,
    file_version_id: versionRowId,
    branch_id: fileRow.primary_branch_id,
    brand_wide: fileRow.brand_wide,
    department: fileRow.department,
    report_type: fileRow.report_type,
    sensitivity_level: fileRow.sensitivity_level,
    metric_key: fact.metric_key,
    metric_value: fact.metric_value,
    dimensions: fact.dimensions,
    period_start: fact.period_start,
    period_end: fact.period_end,
    grain: fact.grain,
    source_row_ref: fact.source_row_ref,
    confidence: fact.confidence,
    created_by: email,
  }));
}
