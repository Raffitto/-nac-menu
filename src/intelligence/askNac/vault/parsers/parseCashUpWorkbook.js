/**
 * Cash-up workbook row parser — Node/Jest mirror of vaultCashUpWorkbookParser.ts.
 */

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

export function excelSerialToIsoDate(serial) {
  if (!Number.isFinite(serial)) return null;
  const wholeDays = Math.floor(serial);
  const epochMs = Date.UTC(1899, 11, 30);
  const dateMs = epochMs + wholeDays * 86400000;
  const d = new Date(dateMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseNumericCell(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw ?? "").trim();
  if (!text || !/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function optionalNumericCell(raw) {
  if (raw == null || raw === "") return null;
  return parseNumericCell(raw);
}

const LEGACY_CASH_UP_COLUMN_MAP = {
  visa: 7,
  cash: 8,
  mastercard: 9,
  mada: 10,
  amex: 11,
  ccm: 13,
  jahez: 14,
  jahezOrders: -1,
  chefz: 15,
  chefzOrders: -1,
  keeta: 16,
  keetaOrders: -1,
  hunger: 17,
  hungerOrders: -1,
  breakfast: 19,
  lunch: 20,
  dinner: 21,
  discounts: 23,
  voidCount: 24,
  voids: 25,
};

function normalizeHeaderLabel(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findHeaderIndex(labels, predicate) {
  const index = labels.findIndex(predicate);
  return index >= 0 ? index : -1;
}

function isDeliveryPlatformHeader(label) {
  return label.includes("jahez") || label === "chefz" || label === "keeta" || label === "hunger";
}

function resolveAdjacentOrderColumn(labels, platformIndex) {
  if (platformIndex < 0) return -1;
  for (let i = platformIndex + 1; i < Math.min(platformIndex + 4, labels.length); i += 1) {
    const label = labels[i];
    if (label.includes("no of order") || label === "order count") return i;
    if (isDeliveryPlatformHeader(label)) break;
    if (label.includes("owners") || label.includes("on account")) break;
  }
  return -1;
}

export function resolveCashUpColumnMap(matrix) {
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

    const jahez = findHeaderIndex(labels, (label) => label.includes("jahez"));
    const chefz = findHeaderIndex(labels, (label) => label === "chefz");
    const keeta = findHeaderIndex(labels, (label) => label === "keeta");
    const hunger = findHeaderIndex(labels, (label) => label === "hunger");

    return {
      visa,
      cash,
      mastercard: findHeaderIndex(labels, (label) => label === "mastercard"),
      mada: findHeaderIndex(labels, (label) => label === "mada"),
      amex: findHeaderIndex(labels, (label) => label === "amex"),
      ccm: findHeaderIndex(labels, (label) => label.includes("ccm")),
      jahez,
      jahezOrders: resolveAdjacentOrderColumn(labels, jahez),
      chefz,
      chefzOrders: resolveAdjacentOrderColumn(labels, chefz),
      keeta,
      keetaOrders: resolveAdjacentOrderColumn(labels, keeta),
      hunger,
      hungerOrders: resolveAdjacentOrderColumn(labels, hunger),
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

function columnIndex(columnMap, key) {
  const index = columnMap[key];
  if (index >= 0) return index;
  const legacy = LEGACY_CASH_UP_COLUMN_MAP[key];
  return legacy >= 0 ? legacy : -1;
}

function optionalOrderCell(row, columnMap, key) {
  const index = columnIndex(columnMap, key);
  if (index < 0) return null;
  return optionalNumericCell(row[index]);
}

function parseDailyRow(row, sourceRowRef, columnMap) {
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
    jahezOrders: optionalOrderCell(row, columnMap, "jahezOrders"),
    chefzSales: optionalNumericCell(row[columnIndex(columnMap, "chefz")]),
    chefzOrders: optionalOrderCell(row, columnMap, "chefzOrders"),
    keetaSales: optionalNumericCell(row[columnIndex(columnMap, "keeta")]),
    keetaOrders: optionalOrderCell(row, columnMap, "keetaOrders"),
    hungerSales: optionalNumericCell(row[columnIndex(columnMap, "hunger")]),
    hungerOrders: optionalOrderCell(row, columnMap, "hungerOrders"),
    breakfastSales: optionalNumericCell(row[columnIndex(columnMap, "breakfast")]),
    lunchSales: optionalNumericCell(row[columnIndex(columnMap, "lunch")]),
    dinnerSales: optionalNumericCell(row[columnIndex(columnMap, "dinner")]),
    discounts: optionalNumericCell(row[columnIndex(columnMap, "discounts")]),
    voidCount: optionalNumericCell(row[columnIndex(columnMap, "voidCount")]),
    voids: optionalNumericCell(row[columnIndex(columnMap, "voids")]),
  };
}

function buildFactsForDailyRow(row) {
  const facts = [];
  const base = {
    period_start: row.businessDate,
    period_end: row.businessDate,
    grain: "daily",
    source_row_ref: row.sourceRowRef,
    confidence: 0.78,
  };

  const add = (metricKey, metricValue, dimensions = {}) => {
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
  add(
    "delivery_orders",
    (row.jahezOrders ?? 0) + (row.chefzOrders ?? 0) + (row.keetaOrders ?? 0) + (row.hungerOrders ?? 0),
  );
  add("delivery_orders", row.jahezOrders, { platform: "jahez" });
  add("delivery_orders", row.chefzOrders, { platform: "chefz" });
  add("delivery_orders", row.keetaOrders, { platform: "keeta" });
  add("delivery_orders", row.hungerOrders, { platform: "hunger" });
  add("ccm_sales", row.ccmSales);
  add("breakfast_sales", row.breakfastSales);
  add("lunch_sales", row.lunchSales);
  add("dinner_sales", row.dinnerSales);
  add("discounts", row.discounts);
  add("void_count", row.voidCount);
  add("voids", row.voids);

  return facts;
}

export function parseCashUpWorkbookMatrices(matrices) {
  const dailyRows = [];

  matrices.forEach((matrix, sheetIndex) => {
    const columnMap = resolveCashUpColumnMap(matrix || []);
    (matrix || []).forEach((row, rowIndex) => {
      const parsed = parseDailyRow(row, `sheet-${sheetIndex + 1}-row-${rowIndex + 1}`, columnMap);
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

export function validateCashUpWorkbookParse(result) {
  if (!result.ok || !result.facts.length) return false;
  if (result.dailyRowCount < MIN_DAILY_ROWS) return false;
  if (result.facts.some((fact) => !fact.period_end)) return false;
  return true;
}
