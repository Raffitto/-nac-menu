import Papa from "papaparse";
import * as XLSX from "xlsx";

const NAME_HEADERS = ["item", "product", "product name", "menu item", "name", "item name", "productname"];
const QTY_HEADERS = ["quantity", "qty", "qty sold", "sold qty", "quantity sold", "units", "count"];
const NET_HEADERS = ["net sales", "net", "net total", "net amount"];
const GROSS_HEADERS = ["gross sales", "gross", "gross total", "gross amount", "total sales"];
const DISCOUNT_HEADERS = ["discount", "discounts", "disc"];
const CATEGORY_HEADERS = ["category", "product category", "menu category", "group"];

function normHeader(h) {
  return String(h || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function findColumn(headers, candidates) {
  const normalized = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  for (const cand of candidates) {
    const hit = normalized.find((h) => h.n === cand || h.n.includes(cand));
    if (hit) return hit.raw;
  }
  return null;
}

export function detectColumnMapping(headers) {
  const h = headers.filter(Boolean);
  return {
    name: findColumn(h, NAME_HEADERS),
    quantity: findColumn(h, QTY_HEADERS),
    netSales: findColumn(h, NET_HEADERS),
    grossSales: findColumn(h, GROSS_HEADERS),
    discount: findColumn(h, DISCOUNT_HEADERS),
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
    const name = String(raw[nameKey] || "").trim();
    if (!name) continue;
    rows.push({
      raw_item_name: name,
      quantity_sold: mapping.quantity ? parseNumber(raw[mapping.quantity]) || 0 : 0,
      net_sales: mapping.netSales ? parseNumber(raw[mapping.netSales]) : null,
      gross_sales: mapping.grossSales ? parseNumber(raw[mapping.grossSales]) : null,
      discount: mapping.discount ? parseNumber(raw[mapping.discount]) : null,
      category: mapping.category ? String(raw[mapping.category] || "").trim() || null : null,
    });
  }
  return { rows, error: rows.length ? null : "No valid product rows found." };
}

function sheetToJson(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

export async function parseFoodicsFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors?.length && !parsed.data?.length) {
      throw new Error(parsed.errors[0]?.message || "CSV parse failed");
    }
    const data = parsed.data || [];
    const headers = parsed.meta?.fields || Object.keys(data[0] || {});
    return { rawRows: data, headers, fileType: "csv" };
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const rawRows = sheetToJson(workbook);
    const headers = Object.keys(rawRows[0] || {});
    return { rawRows, headers, fileType: "xlsx" };
  }

  throw new Error("Unsupported file type. Upload CSV or XLSX.");
}
