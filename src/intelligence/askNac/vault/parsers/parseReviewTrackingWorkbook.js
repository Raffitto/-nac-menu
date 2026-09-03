/**
 * Parse the operational Google Drive workbook "2026 review tracking":
 * monthly tabs, staff rows × date columns, manually entered review counts.
 */

import { canonicalStaffName } from "../../../../dashboard/config/staffRoles";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const SKIP_NAME = /^(total|daily total|grand total|overall)$/i;
const SKIP_HEADER = /^(total|period total|month)$/i;

export function isReviewTrackingWorkbookName(name = "") {
  const text = String(name || "");
  return /\breview\s+tracking\b/i.test(text) && !/\breception\s+daily\b/i.test(text);
}

export function excelSerialToIsoDate(serial) {
  if (!Number.isFinite(serial)) return null;
  const dateMs = EXCEL_EPOCH_MS + Math.floor(serial) * 86400000;
  const d = new Date(dateMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function cellToIsoDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) return excelSerialToIsoDate(value);
    return null;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function parseCount(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).trim();
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function findHeaderRow(aoa = []) {
  for (let r = 0; r < Math.min(8, aoa.length); r += 1) {
    const row = aoa[r] || [];
    let dates = 0;
    for (let c = 1; c < row.length; c += 1) {
      if (cellToIsoDate(row[c])) dates += 1;
    }
    if (dates >= 2) return r;
  }
  return -1;
}

function dateColumns(headerRow = []) {
  const cols = [];
  for (let c = 1; c < headerRow.length; c += 1) {
    const label = String(headerRow[c] ?? "").trim();
    if (SKIP_HEADER.test(label)) continue;
    const iso = cellToIsoDate(headerRow[c]);
    if (iso) cols.push({ index: c, reviewDate: iso });
  }
  return cols;
}

export function parseReviewTrackingSheet(aoa = [], sheetName = "") {
  const headerIndex = findHeaderRow(aoa);
  if (headerIndex < 0) return { entries: [], sheetName };
  const cols = dateColumns(aoa[headerIndex] || []);
  const entries = [];
  let emptyStreak = 0;
  for (let r = headerIndex + 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    const rawName = String(row[0] ?? "").trim();
    if (!rawName) {
      emptyStreak += 1;
      if (emptyStreak >= 8) break;
      continue;
    }
    emptyStreak = 0;
    if (SKIP_NAME.test(rawName)) continue;
    const staffName = canonicalStaffName(rawName);
    if (!staffName || staffName === "Unassigned") continue;
    for (const col of cols) {
      const count = parseCount(row[col.index]);
      if (count == null) continue;
      entries.push({
        review_date: col.reviewDate,
        staff_name: staffName,
        source_staff_name: rawName,
        review_count: count,
        source_sheet: sheetName,
      });
    }
  }
  return { entries, sheetName };
}

export function parseReviewTrackingWorkbook(sheets = {}) {
  const entries = [];
  Object.entries(sheets).forEach(([sheetName, aoa]) => {
    const parsed = parseReviewTrackingSheet(aoa, sheetName);
    entries.push(...parsed.entries);
  });
  const dates = entries.map((e) => e.review_date).sort();
  return {
    ok: entries.length > 0,
    error: entries.length ? null : "No staff/date review counts found.",
    entries,
    periodStart: dates[0] || null,
    periodEnd: dates[dates.length - 1] || null,
    parser: "google_review_tracking_workbook",
  };
}

export function parseReviewTrackingWorkbookFromXlsxBuffer(buffer) {
  const XLSX = require("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheets = {};
  workbook.SheetNames.forEach((name) => {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
    });
  });
  return parseReviewTrackingWorkbook(sheets);
}
