import Papa from "papaparse";
import * as XLSX from "xlsx";

const NAME_HEADERS = ["product", "item", "product name", "menu item", "name", "item name"];
const QTY_HEADERS = ["net quantity", "quantity", "qty", "qty sold", "sold qty", "quantity sold", "units"];
const NET_HEADERS = ["net sales", "net", "net total", "net amount"];
const GROSS_HEADERS = ["gross sales", "gross", "gross total", "gross amount", "total sales"];
const DISCOUNT_HEADERS = ["discount amount", "discount", "discounts", "disc"];
const CATEGORY_HEADERS = ["category", "product category", "menu category", "group"];

function normHeader(h) {
  return String(h || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normCell(v) {
  return String(v ?? "").trim();
}

function rowToStrings(row) {
  if (!Array.isArray(row)) return [];
  return row.map(normCell);
}

function isFoodicsHeaderRow(row) {
  const cells = rowToStrings(row).map(normHeader);
  const hasProduct = cells.some((c) => c === "product");
  const hasNetQty = cells.some((c) => c === "net quantity" || c.includes("net quantity"));
  const hasGrossSales = cells.some((c) => c === "gross sales" || c.startsWith("gross sales"));
  return hasProduct && (hasNetQty || hasGrossSales);
}

/** Scan first N rows, find real Foodics table header, return headers + data objects */
export function findFoodicsHeaderAndData(matrix, scanLimit = 20) {
  const rows = Array.isArray(matrix) ? matrix : [];
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(scanLimit, rows.length); i++) {
    if (isFoodicsHeaderRow(rows[i])) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex < 0) {
    headerRowIndex = rows.findIndex((r) => rowToStrings(r).some(Boolean));
    if (headerRowIndex < 0) {
      return { headerRowIndex: -1, headers: [], dataRows: [] };
    }
  }

  const headers = rowToStrings(rows[headerRowIndex]).filter((h, idx, arr) => {
    if (!h) return false;
    return arr.indexOf(h) === idx;
  });

  const dataRows = rows
    .slice(headerRowIndex + 1)
    .map((row) => {
      const cells = rowToStrings(row);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx] ?? "";
      });
      return obj;
    })
    .filter((obj) => Object.values(obj).some((v) => normCell(v)));

  return { headerRowIndex, headers, dataRows };
}

function findColumnExact(headers, exactNames) {
  const normalized = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  for (const name of exactNames) {
    const hit = normalized.find((h) => h.n === name);
    if (hit) return hit.raw;
  }
  return null;
}

function findColumn(headers, candidates, { exclude = [] } = {}) {
  const normalized = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  const excludeSet = new Set(exclude.map(normHeader));
  for (const cand of candidates) {
    const hit = normalized.find(
      (h) => !excludeSet.has(h.n) && (h.n === cand || h.n.includes(cand)),
    );
    if (hit) return hit.raw;
  }
  return null;
}

export function detectColumnMapping(headers) {
  const h = headers.filter(Boolean);

  const netSales =
    findColumnExact(h, ["net sales"]) ||
    findColumn(h, NET_HEADERS, { exclude: ["net sales with tax", "net sales without tax"] });

  return {
    name: findColumnExact(h, ["product"]) || findColumn(h, NAME_HEADERS),
    quantity: findColumnExact(h, ["net quantity"]) || findColumn(h, QTY_HEADERS),
    netSales,
    grossSales: findColumnExact(h, ["gross sales"]) || findColumn(h, GROSS_HEADERS, { exclude: ["gross sales without tax"] }),
    discount: findColumnExact(h, ["discount amount"]) || findColumn(h, DISCOUNT_HEADERS),
    category: findColumn(h, CATEGORY_HEADERS),
    allHeaders: h,
  };
}

function parseNumber(val) {
  if (val == null || val === "") return null;
  const n = Number(String(val).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function rowsFromMappedData(rawRows, mapping) {
  const nameKey = mapping.name;
  if (!nameKey) return { rows: [], error: "Item name column is required." };

  const rows = [];
  for (const raw of rawRows) {
    const name = normCell(raw[nameKey]);
    if (!name) continue;
    rows.push({
      raw_item_name: name,
      quantity_sold: mapping.quantity ? parseNumber(raw[mapping.quantity]) || 0 : 0,
      net_sales: mapping.netSales ? parseNumber(raw[mapping.netSales]) : null,
      gross_sales: mapping.grossSales ? parseNumber(raw[mapping.grossSales]) : null,
      discount: mapping.discount ? parseNumber(raw[mapping.discount]) : null,
      category: mapping.category ? normCell(raw[mapping.category]) || null : null,
    });
  }
  return { rows, error: rows.length ? null : "No valid product rows found." };
}

async function readFileMatrix(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
    if (parsed.errors?.length && !parsed.data?.length) {
      throw new Error(parsed.errors[0]?.message || "CSV parse failed");
    }
    return { matrix: parsed.data || [], fileType: "csv" };
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    return { matrix, fileType: "xlsx" };
  }

  throw new Error("Unsupported file type. Upload CSV or XLSX.");
}

export async function parseFoodicsFile(file) {
  const { matrix, fileType } = await readFileMatrix(file);
  const { headerRowIndex, headers, dataRows } = findFoodicsHeaderAndData(matrix);
  const mapping = detectColumnMapping(headers);

  return {
    rawRows: dataRows,
    headers,
    mapping,
    headerRowIndex,
    fileType,
    skippedHeaderRows: Math.max(0, headerRowIndex),
  };
}
