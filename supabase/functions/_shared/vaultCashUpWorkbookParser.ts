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

function parseDailyRow(row: unknown[], sourceRowRef: string): ParsedDailyRow | null {
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
    visaSales: optionalNumericCell(row[7]),
    cashSales: optionalNumericCell(row[8]),
    mastercardSales: optionalNumericCell(row[9]),
    madaSales: optionalNumericCell(row[10]),
    amexSales: optionalNumericCell(row[11]),
    ccmSales: optionalNumericCell(row[13]),
    jahezSales: optionalNumericCell(row[14]),
    chefzSales: optionalNumericCell(row[15]),
    keetaSales: optionalNumericCell(row[16]),
    hungerSales: optionalNumericCell(row[17]),
    breakfastSales: optionalNumericCell(row[19]),
    lunchSales: optionalNumericCell(row[20]),
    dinnerSales: optionalNumericCell(row[21]),
    discounts: optionalNumericCell(row[23]),
    voidCount: optionalNumericCell(row[24]),
    voids: optionalNumericCell(row[25]),
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
    (matrix || []).forEach((row, rowIndex) => {
      const parsed = parseDailyRow(row as unknown[], `sheet-${sheetIndex + 1}-row-${rowIndex + 1}`);
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
