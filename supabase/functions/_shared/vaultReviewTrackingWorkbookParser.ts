/**
 * Drive ingest parser for "2026 review tracking" monthly staff × date workbooks.
 */

export type ReviewTrackingEntry = {
  review_date: string;
  staff_name: string;
  source_staff_name: string;
  review_count: number;
  source_sheet: string;
};

export type ReviewTrackingParseResult = {
  ok: boolean;
  error: string | null;
  entries: ReviewTrackingEntry[];
  periodStart: string | null;
  periodEnd: string | null;
  parser: "google_review_tracking_workbook";
};

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const SKIP_NAME = /^(total|daily total|grand total|overall)$/i;
const SKIP_HEADER = /^(total|period total|month)$/i;

const STAFF_ALIASES: Record<string, string> = {
  kaium: "Kayum",
  kayum: "Kayum",
  "boy boy": "Boyboy",
  boyboy: "Boyboy",
  "abu sufiyan": "Abu Sofian",
  "abu sofian": "Abu Sofian",
  lyn: "Lyn",
  saif: "Saiful",
  saiful: "Saiful",
  "mohamed azhar": "Azhar",
  azhar: "Azhar",
};

export function isReviewTrackingWorkbookName(name = "") {
  const text = String(name || "");
  return /\breview\s+tracking\b/i.test(text) && !/\breception\s+daily\b/i.test(text);
}

function canonicalStaffName(name: string) {
  const raw = String(name || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (STAFF_ALIASES[lower]) return STAFF_ALIASES[lower];
  return raw;
}

function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const dateMs = EXCEL_EPOCH_MS + Math.floor(serial) * 86400000;
  const d = new Date(dateMs);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function cellToIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    return excelSerialToIsoDate(value);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function parseCount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).trim();
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function findHeaderRow(aoa: unknown[][]) {
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

function parseSheet(aoa: unknown[][], sheetName: string): ReviewTrackingEntry[] {
  const headerIndex = findHeaderRow(aoa);
  if (headerIndex < 0) return [];
  const header = aoa[headerIndex] || [];
  const cols: Array<{ index: number; reviewDate: string }> = [];
  for (let c = 1; c < header.length; c += 1) {
    const label = String(header[c] ?? "").trim();
    if (SKIP_HEADER.test(label)) continue;
    const iso = cellToIsoDate(header[c]);
    if (iso) cols.push({ index: c, reviewDate: iso });
  }
  const entries: ReviewTrackingEntry[] = [];
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
    if (!staffName) continue;
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
  return entries;
}

export function parseReviewTrackingWorkbook(sheets: Record<string, unknown[][]>): ReviewTrackingParseResult {
  const entries: ReviewTrackingEntry[] = [];
  for (const [sheetName, aoa] of Object.entries(sheets || {})) {
    entries.push(...parseSheet(aoa || [], sheetName));
  }
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

export async function parseReviewTrackingWorkbookFromXlsxBuffer(buffer: ArrayBuffer): Promise<ReviewTrackingParseResult> {
  const XLSX = await import("npm:xlsx@0.18.5");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheets: Record<string, unknown[][]> = {};
  for (const name of workbook.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
    }) as unknown[][];
  }
  return parseReviewTrackingWorkbook(sheets);
}
