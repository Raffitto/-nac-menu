/**
 * Monthly Logbook workbooks. One worksheet is one business day.
 * Cells are found by their labels. Macros are never read or executed.
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const RECEPTION_COLUMNS = [
  { key: "reservations", re: /^reservations?$/i },
  { key: "covers", re: /^covers?$/i },
  { key: "walkins", re: /^walk[\s-]?ins?$/i },
  { key: "no_shows", re: /^no[\s-]?shows?$/i },
  { key: "cancellations", re: /^cancellations?$/i },
];

const NARRATIVE_LABELS = [
  { key: "breakfast_notes", re: /^breakfast\s*notes?$/i },
  { key: "lunch_notes", re: /^lunch\s*notes?$/i },
  { key: "dinner_notes", re: /^dinner\s*notes?$/i },
  { key: "complaints", re: /^(?:guest\s+)?complaints?$/i },
  { key: "operational_issues", re: /^(?:operational\s+)?(?:incidents?|issues?)$/i },
  { key: "staff_performance_notes", re: /^staff\s*performance(?:\s*observations?|\s*notes?)?$/i },
  { key: "handover_notes", re: /^handover(?:\s*information)?$/i },
  { key: "training_notes", re: /^training(?:\s*notes?)?$/i },
  { key: "operational_highlights", re: /^(?:operational\s+improvement|brainstorming)(?:\s*notes?)?$/i },
  { key: "lunch_mod", re: /^lunch\s*(?:restaurant\s*)?(?:manager|mod)$/i },
  { key: "dinner_mod", re: /^dinner\s*(?:restaurant\s*)?(?:manager|mod)$/i },
  { key: "chef_on_duty", re: /^chef(?:\s*on\s*duty)?$/i },
  { key: "bar_mod", re: /^bar\s*(?:manager(?:\s*on\s*duty)?|mod)$/i },
];

const REVIEW_LABELS = [5, 4, 3, 2, 1].map((star) => ({
  star,
  re: new RegExp(`^${star}\\s*[-*]?\\s*stars?$`, "i"),
}));

const SHIFT_LABELS = [
  { shift: "breakfast", re: /^breakfast$/i },
  { shift: "lunch", re: /^lunch$/i },
  { shift: "dinner", re: /^dinner$/i },
  { shift: "total", re: /^(?:daily\s+)?totals?$/i },
];

function cleanLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseWorksheetBusinessDate(name) {
  const match = cleanLabel(name).match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return utc.toISOString().slice(0, 10);
}

export function isTemplateSheet(name) {
  return /^(?:copy of\s+)?template$/i.test(cleanLabel(name));
}

export function parseDisplayDate(value) {
  const text = cleanLabel(value);
  const named = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (named) return parseWorksheetBusinessDate(`${named[1]} ${named[2].slice(0, 3)} ${named[3]}`);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export function branchFromLogbookFilename(filename) {
  const match = String(filename || "").toLowerCase().match(/\b(khobar|riyadh|jeddah)\b/);
  return match ? match[1] : null;
}

function cellAt(sheet, row, column) {
  const address = XLSXEncode(row, column);
  const cell = sheet?.[address];
  if (!cell || (cell.v == null && cell.w == null && !cell.f)) return { kind: "empty", value: null, formula: null, display: "" };
  const formula = cell.f ? String(cell.f) : null;
  const display = cleanLabel(cell.w != null ? cell.w : cell.v);
  const hasValue = cell.v !== undefined && cell.v !== null && cell.v !== "";
  if (formula && !hasValue) return { kind: "unresolved", value: null, formula, display: "" };
  if (formula) return { kind: "formula", value: cell.v, formula, display };
  return { kind: "entered", value: cell.v, formula: null, display };
}

function XLSXEncode(row, column) {
  let dividend = column + 1;
  let name = "";
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return `${name}${row + 1}`;
}

function sheetBounds(sheet) {
  const ref = sheet?.["!ref"];
  if (!ref) return null;
  const [start, end] = ref.split(":");
  const decode = (address) => {
    const match = address.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return { c: 0, r: 0 };
    let column = 0;
    for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
    return { c: column - 1, r: Number(match[2]) - 1 };
  };
  return { s: decode(start), e: decode(end || start) };
}

function matrixFromSheet(sheet) {
  const bounds = sheetBounds(sheet);
  if (!bounds) return [];
  const rows = [];
  for (let row = bounds.s.r; row <= bounds.e.r; row += 1) {
    const values = [];
    for (let column = bounds.s.c; column <= bounds.e.c; column += 1) values.push(cellAt(sheet, row, column));
    rows.push(values);
  }
  return rows;
}

function fingerprintMatrix(rows) {
  const parts = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (!cell || cell.kind === "empty") return;
      parts.push(`${rowIndex}:${columnIndex}:${cell.kind}:${cell.formula || ""}:${cell.value ?? ""}`);
    });
  });
  let hash = 5381;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

function labelText(cell) {
  if (!cell || cell.kind === "unresolved") return "";
  if (cell.display) return cleanLabel(cell.display);
  if (cell.value == null) return "";
  return cleanLabel(cell.value);
}

function numberFrom(cell) {
  if (!cell || cell.kind === "empty") return { state: "missing" };
  if (cell.kind === "unresolved") {
    return { state: "unresolved", formula: cell.formula, external: /\[/.test(cell.formula || "") };
  }
  const value = typeof cell.value === "number" ? cell.value : Number(String(cell.value).replace(/,/g, ""));
  if (!Number.isFinite(value)) return { state: "missing" };
  return { state: "resolved", value, kind: cell.kind, formula: cell.formula };
}

function neighborValue(matrix, rowIndex, columnIndex) {
  const right = matrix[rowIndex]?.[columnIndex + 1];
  if (right && right.kind !== "empty") return right;
  return matrix[rowIndex + 1]?.[columnIndex] || { kind: "empty", value: null, formula: null };
}

function findNarratives(matrix) {
  const found = [];
  const headings = [
    { label: /^breakfast$/i, key: "breakfast_notes" },
    { label: /^lunch$/i, key: "lunch_notes" },
    { label: /^dinner$/i, key: "dinner_notes" },
    { label: /^training\\s*&\\s*brainstorming$/i, key: "training_notes" },
  ];
  const boundaries = /^(?:reception\\s*[–-]\\s*hostess|google reviews|handover\\s*\\/\\s*highlights|lunch shift|dinner shift)$/i;
  let active = null;
  const sections = new Map();
  for (const row of matrix) {
    const first = labelText(row[0]);
    const heading = headings.find((item) => item.label.test(first));
    if (heading) {
      active = heading.key;
      if (!sections.has(active)) sections.set(active, []);
      continue;
    }
    if (boundaries.test(first) || /^shift$/i.test(first)) {
      active = null;
      continue;
    }
    if (!active) continue;
    // Only the first column holds shift narratives; ignore unrelated table cells.
    const raw = row[0]?.value == null ? "" : String(row[0].value);
    const value = raw.trim();
    if (!value || /^[•\\s]*$/.test(value) || value.length < 3 || /^C$/i.test(value)) continue;
    sections.get(active).push(value);
  }
  for (const [key, entries] of sections) {
    if (entries.length) found.push({ key, text: entries.join("\\n"), kind: "entered" });
  }
  // Personnel labels occur twice, under lunch and dinner headers. Values are
  // located in the first populated cell to the right, not necessarily adjacent.
  for (const row of matrix) {
    for (const [labelColumn, shift] of [[0, "lunch"], [4, "dinner"]]) {
      const label = labelText(row[labelColumn]);
      const type = /^mod restaurant$/i.test(label) ? "mod"
        : /^chef on duty$/i.test(label) ? "chef"
        : /^mod bar$/i.test(label) ? "bar_mod" : null;
      if (!type) continue;
      const limit = shift === "lunch" ? 4 : row.length;
      for (let col = labelColumn + 1; col < limit; col++) {
        const cell = row[col];
        const value = labelText(cell);
        if (!value) continue;
        if (/^(?:mod restaurant|chef on duty|mod bar)$/i.test(value)) break;
        found.push({ key: type === "bar_mod" ? "bar_mod" : type === "chef" ? "chef_on_duty" : shift + "_mod",
          shift, text: value, kind: cell.kind });
        break;
      }
    }
  }
  return found;
}

function findReception(matrix) {
  let header = null;
  matrix.forEach((row, rowIndex) => {
    if (header) return;
    const columns = {};
    row.forEach((cell, columnIndex) => {
      const label = labelText(cell);
      const match = RECEPTION_COLUMNS.find((entry) => entry.re.test(label));
      if (match) columns[match.key] = columnIndex;
    });
    if (Object.keys(columns).length >= 3) header = { rowIndex, columns };
  });
  if (!header) return { metrics: [], unresolved: 0, warnings: [], dependencies: [] };

  const metrics = [];
  const warnings = [];
  const dependencies = [];
  let unresolved = 0;
  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex];
    const shift = SHIFT_LABELS.find((entry) => entry.re.test(labelText(row[0]) || labelText(row[1])));
    if (!shift) continue;
    const labelColumn = labelText(row[0]) ? 0 : 1;
    const values = {};
    for (const [key, columnIndex] of Object.entries(header.columns)) {
      const adjusted = columnIndex + (labelColumn === 1 && columnIndex > 0 ? 0 : 0);
      const reading = numberFrom(row[adjusted] || row[columnIndex]);
      values[key] = reading;
      if (reading.state === "unresolved") {
        unresolved += 1;
        if (reading.external) dependencies.push({ metric: key, shift: shift.shift, formula: reading.formula });
      }
    }
    metrics.push({ shift: shift.shift, values });
  }

  const daily = {};
  for (const column of RECEPTION_COLUMNS) {
    const shifts = metrics.filter((row) => row.shift !== "total");
    const total = metrics.find((row) => row.shift === "total");
    const totalReading = total?.values?.[column.key];
    const shiftReadings = shifts.map((row) => row.values?.[column.key]).filter(Boolean);
    const resolvedShifts = shiftReadings.filter((reading) => reading.state === "resolved");
    const missingShifts = shiftReadings.filter((reading) => reading.state === "missing");
    const shiftSum = resolvedShifts.reduce((sum, reading) => sum + reading.value, 0);
    const allShiftsResolved = shiftReadings.length > 0 && resolvedShifts.length === shiftReadings.length;
    if (missingShifts.length === shiftReadings.length && shiftReadings.length > 0) {
      daily[column.key] = totalReading?.state === "unresolved"
        ? { state: "unresolved", formula: totalReading.formula || null }
        : { state: "unfinished" };
      continue;
    }
    if (totalReading?.state === "resolved" && allShiftsResolved && shiftSum !== totalReading.value) {
      warnings.push(`${column.key} daily total ${totalReading.value} does not equal shift sum ${shiftSum}`);
      daily[column.key] = { state: "mismatch", shifts: Object.fromEntries(shifts.map((row) => [row.shift, row.values[column.key]])) };
      continue;
    }
    if (totalReading?.state === "resolved") {
      daily[column.key] = {
        state: "resolved",
        value: totalReading.value,
        kind: totalReading.kind,
        formula: totalReading.formula,
        shifts: Object.fromEntries(shifts.map((row) => [row.shift, row.values?.[column.key]?.state === "resolved" ? row.values[column.key].value : null])),
      };
      continue;
    }
    if (totalReading?.state === "unresolved" || shiftReadings.some((reading) => reading.state === "unresolved")) {
      daily[column.key] = { state: "unresolved", formula: totalReading?.formula || null };
    }
  }
  return { metrics, daily, unresolved, warnings, dependencies };
}

function findReviews(matrix) {
  const counts = {};
  const unresolved = [];
  matrix.forEach((row, rowIndex) => {
    const starColumns = [];
    row.forEach((cell, columnIndex) => {
      const label = labelText(cell);
      const match = REVIEW_LABELS.find((entry) => entry.re.test(label));
      if (match) starColumns.push({ star: match.star, columnIndex });
    });
    if (starColumns.length >= 3) {
      starColumns.forEach(({ star, columnIndex }) => {
        if (counts[star]) return;
        const reading = numberFrom(matrix[rowIndex + 1]?.[columnIndex]);
        if (reading.state === "resolved") counts[star] = reading;
        else if (reading.state === "unresolved") unresolved.push({ star, formula: reading.formula });
      });
      return;
    }
    row.forEach((cell, columnIndex) => {
      const label = labelText(cell);
      const match = REVIEW_LABELS.find((entry) => entry.re.test(label));
      if (!match || counts[match.star]) return;
      const reading = numberFrom(neighborValue(matrix, rowIndex, columnIndex));
      if (reading.state === "resolved") counts[match.star] = reading;
      else if (reading.state === "unresolved") unresolved.push({ star: match.star, formula: reading.formula });
    });
  });
  return { counts, unresolved };
}

function findInternalDate(matrix) {
  for (const row of matrix) {
    for (let index = 0; index < row.length; index += 1) {
      if (!/^(?:business\s+)?date$/i.test(labelText(row[index]))) continue;
      for (let next = index + 1; next < row.length; next += 1) {
        const parsed = parseDisplayDate(labelText(row[next]));
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

const RECEPTION_KEYS = ["reservations", "covers", "walkins", "no_shows", "cancellations"];

function sheetIsComplete(narratives, reception) {
  const narrative = narratives.some((item) => cleanLabel(item.text).replace(/^•\s*/, "").length > 2);
  const shifts = ["breakfast", "lunch", "dinner"].every((shift) => (
    reception.metrics || []
  ).some((row) => row.shift === shift && Object.values(row.values || {}).some((reading) => reading.state === "resolved")));
  const totals = RECEPTION_KEYS.map((key) => reception.daily?.[key]?.state);
  if (!narrative || !shifts) return "awaiting_completion";
  if (totals.some((state) => state === "unresolved")) return "formula_unresolved";
  if (totals.some((state) => state === "unfinished" || state === "mismatch" || state !== "resolved")) return "awaiting_completion";
  return "publish";
}

function fact(context, date, key, metricValue, dimensions, grain = "daily") {
  return {
    file_id: context.fileId || null,
    branch_id: context.branchId,
    brand_wide: false,
    department: context.department || "operations",
    report_type: "daily_logbook",
    sensitivity_level: context.sensitivityLevel || "internal",
    metric_key: key,
    metric_value: metricValue,
    metric_unit: null,
    dimensions,
    period_start: date,
    period_end: date,
    grain,
    source_row_ref: `sheet:${date}:${key}:${dimensions?.shift || "daily"}`,
    confidence: 0.8,
    created_by: context.createdBy || null,
  };
}

function provenance(kind) {
  if (kind === "formula") return "formula";
  if (kind === "entered") return "entered";
  return "unresolved";
}

export function parseMonthlyLogbookSheets(workbook, context = {}) {
  const filename = context.filename || "";
  const fileBranch = branchFromLogbookFilename(filename);
  if (fileBranch && context.branchId && fileBranch !== context.branchId) {
    return {
      ok: false,
      error: "Workbook branch does not match the Drive folder branch.",
      branchId: context.branchId,
      sheets: [],
      facts: [],
    };
  }
  const branchId = context.branchId || fileBranch;
  const occupied = new Set(context.occupiedDates || []);
  const previous = context.previousFingerprints || {};
  const sheets = [];
  const facts = [];
  const names = workbook?.SheetNames || [];

  for (const name of names) {
    if (isTemplateSheet(name)) {
      sheets.push({ name, businessDate: null, status: "ignored", publish: false, fingerprint: null });
      continue;
    }
    const businessDate = parseWorksheetBusinessDate(name);
    const matrix = matrixFromSheet(workbook.Sheets?.[name] || {});
    const fingerprint = fingerprintMatrix(matrix);
    if (!businessDate) {
      sheets.push({ name, businessDate: null, status: "unrecognized", publish: false, fingerprint });
      continue;
    }
    // Temporary production recovery freeze: do not publish October 19 or later
    // from monthly workbooks until an operator explicitly lifts this cutoff.
    if (context.publishThrough && businessDate > context.publishThrough) {
      sheets.push({ name, businessDate, status: "publication_cutoff", publish: false, fingerprint });
      continue;
    }
    if (occupied.has(businessDate)) {
      sheets.push({ name, businessDate, status: "skipped_historical", publish: false, fingerprint });
      continue;
    }
    if (previous[businessDate] && previous[businessDate] === fingerprint && !context.forceReparseDates?.includes(businessDate)) {
      sheets.push({ name, businessDate, status: "unchanged", publish: false, fingerprint });
      continue;
    }

    const narratives = findNarratives(matrix);
    const reception = findReception(matrix);
    const reviews = findReviews(matrix);
    const unresolved = reception.unresolved + reviews.unresolved.length;
    const internalDate = findInternalDate(matrix);
    let status = "publish";
    if (internalDate && internalDate !== businessDate) status = "date_mismatch";
    else if (!internalDate) status = "awaiting_completion";
    else status = sheetIsComplete(narratives, reception);

    const sheetFacts = [];
    if (status === "publish") {
      const baseDimensions = {
        worksheet: name,
        source_workbook_id: context.workbookId || null,
        sheet_fingerprint: fingerprint,
        branch_id: branchId,
      };
      for (const narrative of narratives) {
        sheetFacts.push(fact({ ...context, branchId }, businessDate, narrative.key, null, {
          ...baseDimensions,
          text_value: narrative.text,
          ...(narrative.shift ? { shift: narrative.shift } : {}),
          provenance: provenance(narrative.kind),
        }, "snapshot"));
      }
      for (const [key, reading] of Object.entries(reception.daily || {})) {
        if (reading.state !== "resolved") continue;
        sheetFacts.push(fact({ ...context, branchId }, businessDate, key, reading.value, {
          ...baseDimensions,
          section: "reception",
          provenance: provenance(reading.kind),
          formula: reading.formula || null,
          shifts: reading.shifts || {},
        }));
      }
      for (const [star, reading] of Object.entries(reviews.counts)) {
        sheetFacts.push(fact({ ...context, branchId }, businessDate, `google_review_${star}`, reading.value, {
          ...baseDimensions,
          source: "google_reviews",
          provenance: provenance(reading.kind),
        }));
      }
      facts.push(...sheetFacts);
    }

    sheets.push({
      name,
      businessDate,
      status,
      publish: status === "publish",
      fingerprint,
      warnings: reception.warnings,
      dependencies: reception.dependencies,
      unresolved,
      factCount: sheetFacts.length,
    });
  }

  const publishedDates = facts.map((item) => item.period_end).filter(Boolean).sort();
  return {
    ok: true,
    branchId,
    macrosExecuted: false,
    format: workbook?.vbaraw ? "xlsm" : "xlsx",
    sheets,
    facts,
    periodStart: publishedDates[0] || null,
    periodEnd: publishedDates[publishedDates.length - 1] || null,
  };
}

export function mergeMonthlyLogbookFacts(existingFacts, parsed) {
  const dateOnly = (value) => String(value || "").slice(0, 10);
  const replaceDates = new Set((parsed.sheets || []).filter((sheet) => sheet.publish).map((sheet) => sheet.businessDate));
  const kept = (existingFacts || []).filter((item) => {
    const date = dateOnly(item.period_end);
    if (replaceDates.has(date)) return false;
    return true;
  });
  return [...kept, ...(parsed.facts || [])];
}

export function summarizeMonthlyLogbookRun(sheets) {
  const dated = (sheets || []).filter((sheet) => sheet.businessDate);
  const blocking = dated.filter((sheet) => ["awaiting_completion", "formula_unresolved", "date_mismatch"].includes(sheet.status));
  let state = "complete";
  if (!dated.length) state = "source_unavailable";
  else if (blocking.length && dated.some((sheet) => sheet.publish || sheet.status === "unchanged" || sheet.status === "skipped_historical")) state = "partial";
  else if (blocking.some((sheet) => sheet.status === "formula_unresolved")) state = "formula_unresolved";
  else if (blocking.length) state = "awaiting_daily_completion";
  return {
    state,
    unpublishedDates: blocking.map((sheet) => sheet.businessDate),
    publishedDates: dated.filter((sheet) => sheet.publish || sheet.status === "unchanged").map((sheet) => sheet.businessDate),
  };
}
