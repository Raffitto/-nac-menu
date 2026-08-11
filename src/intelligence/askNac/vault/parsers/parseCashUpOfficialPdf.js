/**
 * Full-fidelity parser for official NAC Cash Up monthly PDF exports
 * (Excel "Save as PDF" with glued weekday+date+numeric cells).
 *
 * Preserves SOURCE_REPORTED monthly totals / Daily Average separately from
 * DERIVED_FROM_DAILY_ROWS aggregates. Does not alter the source file.
 */

export const CASH_UP_OFFICIAL_PDF_PARSER_VERSION = "cash_up_official_pdf_v1";

const WEEKDAY = "(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
const DATE_DMY = "(\\d{2}/\\d{2}/\\d{4})";

const MONEY_RE = /^-?\d{1,3}(?:,\d{3})*\.\d{2}/;

function parseMoneyToken(text, index) {
  const slice = text.slice(index);
  const m = slice.match(MONEY_RE);
  if (!m) return null;
  return { value: Number(m[0].replace(/,/g, "")), length: m[0].length };
}

function splitGuestsOrders(digitBlob) {
  const digits = String(digitBlob || "");
  if (!/^\d+$/.test(digits) || digits.length < 2) return null;
  if (digits.length === 6) return { guests: Number(digits.slice(0, 3)), orders: Number(digits.slice(3)) };
  if (digits.length === 5) return { guests: Number(digits.slice(0, 3)), orders: Number(digits.slice(3)) };
  if (digits.length === 4) return { guests: Number(digits.slice(0, 2)), orders: Number(digits.slice(2)) };
  if (digits.length === 7) return { guests: Number(digits.slice(0, 4)), orders: Number(digits.slice(4)) };
  if (digits.length === 3) return { guests: Number(digits.slice(0, 2)), orders: Number(digits.slice(2)) };
  return null;
}

function parseGuestsOrdersAvg(text, index) {
  const slice = text.slice(index);
  // guests+orders digits then avg with exactly 2 integer digits (typical cash-up layout)
  const m = slice.match(/^(\d{2,7})(\d{2}\.\d{2})/);
  if (!m) return null;
  const split = splitGuestsOrders(m[1]);
  if (!split) return null;
  return {
    guests: split.guests,
    orders: split.orders,
    avgPerGuest: Number(m[2]),
    length: m[0].length,
  };
}

function dmyToIso(dmy) {
  const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parsePaymentTail(text, index) {
  let i = index;
  const moneyVals = [];
  while (i < text.length && moneyVals.length < 28) {
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Total|Target|DailyAverage|Budget)/i.test(text.slice(i))) {
      break;
    }
    // Skip non-numeric note fragments between fields
    if (!/[0-9-]/.test(text[i])) {
      i += 1;
      continue;
    }
    const money = parseMoneyToken(text, i);
    if (money) {
      moneyVals.push(money.value);
      i += money.length;
      continue;
    }
    const intTok = text.slice(i).match(/^-?\d+/);
    if (intTok) {
      moneyVals.push(Number(intTok[0]));
      i += intTok[0].length;
      continue;
    }
    break;
  }
  return { values: moneyVals, end: i };
}

/**
 * Map payment/daypart tail using the official column order after Average per guest.
 * Unmapped leftovers are retained under raw_tail.
 */
function mapPaymentFields(values = []) {
  const names = [
    "visa",
    "cash",
    "mastercard",
    "mada",
    "amex",
    "gcc_net",
    "ccm",
    "jahez",
    "jahez_orders",
    "chefz",
    "chefz_orders",
    "keeta",
    "keeta_orders",
    "hunger",
    "hunger_orders",
    "owners_on_account",
    "tips",
    "breakfast",
    "lunch",
    "dinner",
    "discount_comp",
    "void_count",
    "void_as_no_waste",
    "void_waste",
  ];
  const mapped = {};
  const uncertain = [];
  names.forEach((name, idx) => {
    if (values[idx] == null) return;
    mapped[name] = values[idx];
  });
  if (values.length > names.length) {
    uncertain.push({
      field: "raw_tail_extra",
      values: values.slice(names.length),
      reason: "More numeric cells than known cash-up columns after average/guest.",
    });
  }
  // Notes / Fady comments are non-numeric in source — not recoverable from glued PDF digits.
  if (values.length < 10) {
    uncertain.push({
      field: "payment_daypart_tail",
      values,
      reason: "Payment/daypart tail shorter than expected; mapping confidence reduced.",
    });
  }
  return { mapped, uncertain };
}

function buildFactsForOfficialDailyRow(row) {
  const facts = [];
  const base = {
    period_start: row.businessDate,
    period_end: row.businessDate,
    grain: "daily",
    source_row_ref: row.sourceRowRef,
    confidence: 0.86,
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

  const p = row.payments || {};
  add("cash_sales", p.cash);
  add(
    "card_sales",
    [p.visa, p.mastercard, p.mada, p.amex].every((v) => v == null)
      ? null
      : (p.visa || 0) + (p.mastercard || 0) + (p.mada || 0) + (p.amex || 0),
  );
  add("payment_method", p.cash, { method: "cash" });
  add("payment_method", p.visa, { method: "visa" });
  add("payment_method", p.mastercard, { method: "mastercard" });
  add("payment_method", p.mada, { method: "mada" });
  add("payment_method", p.amex, { method: "amex" });
  add("payment_method", p.gcc_net, { method: "gcc_net" });
  add(
    "delivery_sales",
    [p.jahez, p.chefz, p.keeta, p.hunger].every((v) => v == null)
      ? null
      : (p.jahez || 0) + (p.chefz || 0) + (p.keeta || 0) + (p.hunger || 0),
  );
  add("delivery_sales", p.jahez, { platform: "jahez" });
  add("delivery_sales", p.chefz, { platform: "chefz" });
  add("delivery_sales", p.keeta, { platform: "keeta" });
  add("delivery_sales", p.hunger, { platform: "hunger" });
  add(
    "delivery_orders",
    [p.jahez_orders, p.chefz_orders, p.keeta_orders, p.hunger_orders].every((v) => v == null)
      ? null
      : (p.jahez_orders || 0) + (p.chefz_orders || 0) + (p.keeta_orders || 0) + (p.hunger_orders || 0),
  );
  add("delivery_orders", p.jahez_orders, { platform: "jahez" });
  add("delivery_orders", p.chefz_orders, { platform: "chefz" });
  add("delivery_orders", p.keeta_orders, { platform: "keeta" });
  add("delivery_orders", p.hunger_orders, { platform: "hunger" });
  add("ccm_sales", p.ccm);
  add("tips", p.tips);
  add("breakfast_sales", p.breakfast);
  add("lunch_sales", p.lunch);
  add("dinner_sales", p.dinner);
  add("discounts", p.discount_comp);
  add("void_count", p.void_count);
  add("voids", p.void_waste ?? p.void_as_no_waste);
  if (p.owners_on_account != null) {
    add("owners_on_account", p.owners_on_account);
  }
  if (row.rawUnmapped?.length) {
    add("raw_extract", null, {
      text_value: "unmapped_numeric_tail",
      values: row.rawUnmapped,
      mapping_uncertainty: true,
    });
  }
  return facts;
}

function sumField(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function nearlyEqual(a, b, tol = 0.05) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

export function extractCashUpPdfPlainText(pdfText) {
  return String(pdfText || "").replace(/\s+/g, "");
}

/**
 * @param {string} pdfText raw extracted PDF text
 * @param {{ branchId?: string, periodMonth?: string }} [context]
 */
export function parseCashUpOfficialPdfText(pdfText, context = {}) {
  const compact = extractCashUpPdfPlainText(pdfText);
  const warnings = [];
  const qualityIssues = [];
  const uncertainFields = [];

  if (!compact) {
    return {
      ok: false,
      error: "Empty PDF text",
      parser: CASH_UP_OFFICIAL_PDF_PARSER_VERSION,
      dailyRows: [],
      facts: [],
      warnings,
      qualityIssues,
    };
  }

  const dayRe = new RegExp(`${WEEKDAY}${DATE_DMY}`, "g");
  const matches = [...compact.matchAll(dayRe)];
  const dailyRows = [];

  for (let idx = 0; idx < matches.length; idx += 1) {
    const match = matches[idx];
    const weekday = match[1];
    const dmy = match[2];
    const businessDate = dmyToIso(dmy);
    const start = match.index + match[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1].index : compact.search(/Total-?\d|Total\d/);
    const body = compact.slice(start, end > start ? end : start + 500);

    let cursor = 0;
    // Skip leading non-numeric note residue
    while (cursor < body.length && !/[0-9-]/.test(body[cursor])) cursor += 1;

    const totalTok = parseMoneyToken(body, cursor);
    if (!totalTok) {
      warnings.push(`Could not parse total sales for ${dmy}`);
      continue;
    }
    cursor += totalTok.length;
    const netTok = parseMoneyToken(body, cursor);
    if (!netTok) {
      warnings.push(`Could not parse net sales for ${dmy}`);
      continue;
    }
    cursor += netTok.length;
    const goa = parseGuestsOrdersAvg(body, cursor);
    if (!goa) {
      warnings.push(`Could not parse guests/orders/avg for ${dmy}`);
      continue;
    }
    cursor += goa.length;
    const tail = parsePaymentTail(body, cursor);
    const mapped = mapPaymentFields(tail.values);
    uncertainFields.push(...mapped.uncertain.map((u) => ({ date: businessDate, ...u })));

    dailyRows.push({
      weekday,
      sourceDate: dmy,
      businessDate,
      sourceRowRef: `pdf-day-${businessDate}`,
      totalSales: totalTok.value,
      netSales: netTok.value,
      guestCount: goa.guests,
      orderCount: goa.orders,
      avgPerGuest: goa.avgPerGuest,
      payments: mapped.mapped,
      rawUnmapped: mapped.uncertain.find((u) => u.field === "raw_tail_extra")?.values || [],
      valueClass: "SOURCE_REPORTED",
    });
  }

  // SOURCE_REPORTED monthly total row (after last daily row)
  let sourceMonthly = null;
  const totalIdx = compact.search(/Total\d/);
  if (totalIdx >= 0) {
    const totalBody = compact.slice(totalIdx + "Total".length, totalIdx + 120);
    const g = parseMoneyToken(totalBody, 0);
    const n = g ? parseMoneyToken(totalBody, g.length) : null;
    let cursor = (g?.length || 0) + (n?.length || 0);
    // Total row often uses integer avg (71) without decimals.
    const blob = totalBody.slice(cursor).match(/^(\d{6,10})/);
    let guests = null;
    let orders = null;
    let avg = null;
    if (blob) {
      // Prefer 4+4+2 when length>=10 (8302350671), else 4+4 / 3+3
      const digits = blob[1];
      if (digits.length >= 10) {
        guests = Number(digits.slice(0, 4));
        orders = Number(digits.slice(4, 8));
        avg = Number(digits.slice(8, 10));
        cursor += 10;
      } else if (digits.length >= 8) {
        guests = Number(digits.slice(0, 4));
        orders = Number(digits.slice(4, 8));
        cursor += 8;
      }
    }
    sourceMonthly = {
      valueClass: "SOURCE_REPORTED",
      grossSales: g?.value ?? null,
      netSales: n?.value ?? null,
      guestCount: guests,
      orderCount: orders,
      avgPerGuest: avg,
    };
  }

  let sourceTarget = null;
  const targetMatch = compact.match(/Target(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (targetMatch) {
    sourceTarget = Number(targetMatch[1].replace(/,/g, ""));
  }

  let sourceDailyAverage = null;
  const daIdx = compact.indexOf("DailyAverage");
  if (daIdx >= 0) {
    const daBody = compact.slice(daIdx + "DailyAverage".length, daIdx + "DailyAverage".length + 80);
    // Daily Average uses 2dp money and 2dp averages: 21,708.57 18,808.46 263.87 111.83 70.82
    const nums = [];
    let i = 0;
    while (i < daBody.length && nums.length < 5) {
      const money = daBody.slice(i).match(/^-?\d{1,3}(?:,\d{3})*\.\d{2}/);
      const dec = daBody.slice(i).match(/^-?\d+\.\d{2}/);
      const tok = money || dec;
      if (!tok) break;
      nums.push(Number(tok[0].replace(/,/g, "")));
      i += tok[0].length;
    }
    if (nums.length >= 5) {
      sourceDailyAverage = {
        valueClass: "SOURCE_REPORTED",
        grossPerDay: nums[0],
        netPerDay: nums[1],
        guestsPerDay: nums[2],
        ordersPerDay: nums[3],
        avgPerGuest: nums[4],
      };
    }
  }

  const derived = {
    valueClass: "DERIVED_FROM_DAILY_ROWS",
    dayCount: dailyRows.length,
    grossSales: Number(sumField(dailyRows, "totalSales").toFixed(2)),
    netSales: Number(sumField(dailyRows, "netSales").toFixed(2)),
    guestCount: sumField(dailyRows, "guestCount"),
    orderCount: sumField(dailyRows, "orderCount"),
  };
  if (derived.dayCount > 0) {
    derived.grossPerDay = Number((derived.grossSales / derived.dayCount).toFixed(2));
    derived.netPerDay = Number((derived.netSales / derived.dayCount).toFixed(2));
    derived.guestsPerDay = Number((derived.guestCount / derived.dayCount).toFixed(2));
    derived.ordersPerDay = Number((derived.orderCount / derived.dayCount).toFixed(2));
    derived.avgPerGuest = derived.guestCount
      ? Number((derived.netSales / derived.guestCount).toFixed(2))
      : null;
  }

  const reconciliation = {
    valueClass: "VALIDATED",
    grossMatch: sourceMonthly?.grossSales != null
      ? nearlyEqual(derived.grossSales, sourceMonthly.grossSales)
      : null,
    netMatch: sourceMonthly?.netSales != null
      ? nearlyEqual(derived.netSales, sourceMonthly.netSales)
      : null,
    guestsMatch: sourceMonthly?.guestCount != null
      ? derived.guestCount === sourceMonthly.guestCount
      : null,
    ordersMatch: sourceMonthly?.orderCount != null
      ? derived.orderCount === sourceMonthly.orderCount
      : null,
    derived,
    sourceMonthly,
    sourceTarget,
  };

  if (sourceDailyAverage && derived.dayCount) {
    const staleGross = !nearlyEqual(sourceDailyAverage.grossPerDay, derived.grossPerDay, 1);
    const staleNet = !nearlyEqual(sourceDailyAverage.netPerDay, derived.netPerDay, 1);
    if (staleGross || staleNet) {
      qualityIssues.push({
        code: "STALE_DAILY_AVERAGE_ROW",
        severity: "WARNING",
        valueClass: "SOURCE_REPORTED",
        detail:
          "Source Daily Average row does not match DERIVED_FROM_DAILY_ROWS averages (likely not recalculated after final day was added).",
        sourceDailyAverage,
        derivedAverages: {
          grossPerDay: derived.grossPerDay,
          netPerDay: derived.netPerDay,
          guestsPerDay: derived.guestsPerDay,
          ordersPerDay: derived.ordersPerDay,
          avgPerGuest: derived.avgPerGuest,
        },
        analyticsPolicy: "Prefer DERIVED_FROM_DAILY_ROWS / validated totals; preserve SOURCE_REPORTED Daily Average as evidence only.",
      });
    }
  }

  const dates = dailyRows.map((r) => r.businessDate).sort();
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length !== dates.length) {
    qualityIssues.push({
      code: "DUPLICATE_DATES",
      severity: "WARNING",
      detail: "Duplicate business dates present in parsed daily rows.",
    });
  }

  const monthPrefix = context.periodMonth || (dates[0] ? dates[0].slice(0, 7) : null);
  if (monthPrefix) {
    const [y, m] = monthPrefix.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const expected = Array.from({ length: daysInMonth }, (_, i) =>
      `${monthPrefix}-${String(i + 1).padStart(2, "0")}`);
    const missing = expected.filter((d) => !uniqueDates.includes(d));
    if (missing.length) {
      qualityIssues.push({
        code: "MISSING_DATES",
        severity: "WARNING",
        detail: `Missing daily rows: ${missing.join(", ")}`,
        missing,
      });
    }
  }

  ["grossMatch", "netMatch", "guestsMatch", "ordersMatch"].forEach((key) => {
    if (reconciliation[key] === false) {
      qualityIssues.push({
        code: "RECONCILIATION_MISMATCH",
        severity: "WARNING",
        detail: `Derived daily sum disagrees with SOURCE_REPORTED monthly on ${key}`,
      });
    }
  });

  const facts = dailyRows.flatMap((row) => buildFactsForOfficialDailyRow(row));
  if (sourceMonthly?.grossSales != null) {
    facts.push({
      metric_key: "source_reported_monthly_gross",
      metric_value: sourceMonthly.grossSales,
      dimensions: { value_class: "SOURCE_REPORTED" },
      period_start: dates[0] || null,
      period_end: dates[dates.length - 1] || null,
      grain: "monthly",
      source_row_ref: "pdf-monthly-total",
      confidence: 0.9,
    });
  }
  if (sourceMonthly?.netSales != null) {
    facts.push({
      metric_key: "source_reported_monthly_net",
      metric_value: sourceMonthly.netSales,
      dimensions: { value_class: "SOURCE_REPORTED" },
      period_start: dates[0] || null,
      period_end: dates[dates.length - 1] || null,
      grain: "monthly",
      source_row_ref: "pdf-monthly-total",
      confidence: 0.9,
    });
  }
  if (sourceTarget != null) {
    facts.push({
      metric_key: "target_sales",
      metric_value: sourceTarget,
      dimensions: { value_class: "SOURCE_REPORTED" },
      period_start: dates[0] || null,
      period_end: dates[dates.length - 1] || null,
      grain: "monthly",
      source_row_ref: "pdf-monthly-target",
      confidence: 0.9,
    });
  }
  if (sourceDailyAverage) {
    facts.push({
      metric_key: "source_reported_daily_average",
      metric_value: sourceDailyAverage.netPerDay,
      dimensions: {
        value_class: "SOURCE_REPORTED",
        stale: qualityIssues.some((q) => q.code === "STALE_DAILY_AVERAGE_ROW"),
        gross_per_day: sourceDailyAverage.grossPerDay,
        net_per_day: sourceDailyAverage.netPerDay,
        guests_per_day: sourceDailyAverage.guestsPerDay,
        orders_per_day: sourceDailyAverage.ordersPerDay,
        avg_per_guest: sourceDailyAverage.avgPerGuest,
      },
      period_start: dates[0] || null,
      period_end: dates[dates.length - 1] || null,
      grain: "monthly",
      source_row_ref: "pdf-daily-average",
      confidence: 0.7,
    });
  }

  const ok = dailyRows.length >= 28 && facts.length > 0;
  return {
    ok,
    error: ok ? null : `Parsed ${dailyRows.length} daily rows (need >= 28).`,
    parser: CASH_UP_OFFICIAL_PDF_PARSER_VERSION,
    branchId: context.branchId || "khobar",
    periodStart: dates[0] || null,
    periodEnd: dates[dates.length - 1] || null,
    dailyRows,
    dailyRowCount: dailyRows.length,
    facts,
    sourceMonthly,
    sourceTarget,
    sourceDailyAverage,
    derived,
    reconciliation,
    warnings,
    qualityIssues,
    uncertainFields,
    analyticsPolicy: {
      prefer: ["DERIVED_FROM_DAILY_ROWS", "VALIDATED"],
      preserveAsEvidenceOnly: ["SOURCE_REPORTED_DAILY_AVERAGE"],
    },
  };
}
