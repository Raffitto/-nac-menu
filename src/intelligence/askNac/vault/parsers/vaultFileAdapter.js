/**
 * File adapter — detects type, extracts text/tables, returns normalized intermediate.
 */

import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  createIntermediate,
  textLinesToMatrix,
} from "./vaultIntermediate";

const EXTENSION_MIME = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

export function detectVaultFileType(file) {
  const name = String(file?.name || "");
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mimeType = file?.type || EXTENSION_MIME[ext] || null;
  return { extension: ext, mimeType, fileType: ext || "unknown" };
}

export function isVaultParseableExtension(extension) {
  return ["csv", "xlsx", "xls", "pdf", "docx", "txt"].includes(String(extension || "").toLowerCase());
}

async function readBlobText(file) {
  if (typeof file.text === "function") {
    return file.text();
  }
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : file.buffer || file.content;
  if (buffer) {
    return Buffer.from(buffer).toString("utf8");
  }
  return String(file.content || "");
}

async function readCsvMatrix(file) {
  const text = await readBlobText(file);
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: false });
  if (parsed.errors?.length && !parsed.data?.length) {
    throw new Error(parsed.errors[0]?.message || "CSV parse failed");
  }
  return { matrix: parsed.data || [], text };
}

async function readXlsxMatrix(file) {
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : file.buffer || file.content;
  const workbook = XLSX.read(buffer, { type: "array" });
  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const lines = matrix
      .map((row) => (Array.isArray(row) ? row.map(String).filter(Boolean).join(" | ") : ""))
      .filter(Boolean);
    return { id: sheetName, label: sheetName, matrix, lines };
  });
  const primary = sections[0]?.matrix || [];
  const text = sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n");
  return { matrix: primary, text, sections };
}

async function readPdfText(file) {
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : file.buffer || file.content;

  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/build/pdf");
    const worker = await import("pdfjs-dist/build/pdf.worker.entry");
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
  } catch (err) {
    throw new Error(
      `PDF text extraction unavailable (${err?.message || "pdfjs-dist not loaded"}). Re-export as XLSX/CSV or install pdfjs-dist.`,
    );
  }

  const loadingTask = pdfjs.getDocument({ data: buffer });
  const doc = await loadingTask.promise;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) pageTexts.push({ pageNo: pageNum, text: line });
  }

  const text = pageTexts.map((p) => p.text).join("\n");
  const matrix = textLinesToMatrix(text.split(/\r?\n/));
  const sections = pageTexts.map((p) => ({
    id: `page-${p.pageNo}`,
    label: `Page ${p.pageNo}`,
    pageNo: p.pageNo,
    lines: p.text.split(/\r?\n/).filter(Boolean),
    matrix: textLinesToMatrix(p.text.split(/\r?\n/)),
    text: p.text,
  }));
  return {
    matrix,
    text,
    pageTexts,
    sections: sections.length
      ? sections
      : [{ id: "pdf", label: "PDF text", lines: text.split(/\r?\n/).filter(Boolean), matrix }],
    adapterWarnings:
      matrix.length < 3
        ? ["PDF table structure weak — using text line heuristics."]
        : [],
  };
}

async function readDocxText(file) {
  const buffer =
    typeof file.arrayBuffer === "function"
      ? await file.arrayBuffer()
      : file.buffer || file.content;

  let mammoth;
  try {
    mammoth = await import("mammoth");
  } catch (err) {
    throw new Error(
      `DOCX extraction unavailable (${err?.message || "mammoth not loaded"}). Save as PDF/XLSX or install mammoth.`,
    );
  }

  const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const result = await mammoth.extractRawText({ buffer: nodeBuffer });
  const text = String(result.value || "").trim();
  const warnings = (result.messages || []).map((m) => m.message).filter(Boolean);
  const matrix = textLinesToMatrix(text.split(/\r?\n/));

  return {
    matrix,
    text,
    sections: [{ id: "docx", label: "Document text", lines: text.split(/\r?\n/).filter(Boolean), matrix }],
    adapterWarnings: [
      ...warnings.slice(0, 3),
      "DOCX converted to plain text — table layout may be approximate.",
    ],
  };
}

/**
 * @param {File|Blob|{ name: string, type?: string, text?: Function, arrayBuffer?: Function, content?: any }} file
 * @param {{ reportType?: string }} metadata
 */
export async function parseUploadedFile(file, metadata = {}) {
  const { extension, mimeType } = detectVaultFileType(file);

  if (!isVaultParseableExtension(extension)) {
    return {
      ok: false,
      error: `Unsupported file type ".${extension}". Use XLSX, CSV, PDF, DOCX, or TXT.`,
      intermediate: null,
    };
  }

  try {
    let payload;

    switch (extension) {
      case "csv": {
        const { matrix, text } = await readCsvMatrix(file);
        payload = createIntermediate({
          fileType: "csv",
          extension,
          mimeType,
          matrix,
          text,
          adapterWarnings: [],
        });
        break;
      }
      case "xlsx":
      case "xls": {
        const { matrix, text, sections } = await readXlsxMatrix(file);
        payload = createIntermediate({
          fileType: extension,
          extension,
          mimeType,
          matrix,
          text,
          sections,
          adapterWarnings: [],
        });
        break;
      }
      case "pdf": {
        const pdf = await readPdfText(file);
        payload = createIntermediate({
          fileType: "pdf",
          extension,
          mimeType,
          matrix: pdf.matrix,
          text: pdf.text,
          sections: pdf.sections,
          adapterWarnings: pdf.adapterWarnings,
        });
        break;
      }
      case "docx": {
        const docx = await readDocxText(file);
        payload = createIntermediate({
          fileType: "docx",
          extension,
          mimeType,
          matrix: docx.matrix,
          text: docx.text,
          sections: docx.sections,
          adapterWarnings: docx.adapterWarnings,
        });
        break;
      }
      case "txt": {
        const text = await readBlobText(file);
        const matrix = textLinesToMatrix(text.split(/\r?\n/));
        payload = createIntermediate({
          fileType: "txt",
          extension,
          mimeType,
          matrix,
          text,
          adapterWarnings: [],
        });
        break;
      }
      default:
        return { ok: false, error: `Unsupported extension ".${extension}".`, intermediate: null };
    }

    if (metadata.reportType) {
      payload.reportTypeHint = metadata.reportType;
    }

    return { ok: true, intermediate: payload, error: null };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "File extraction failed",
      intermediate: null,
    };
  }
}

/** @deprecated use parseUploadedFile */
export async function readVaultSpreadsheetMatrix(file) {
  const result = await parseUploadedFile(file);
  if (!result.ok) throw new Error(result.error);
  return { matrix: result.intermediate.matrix, fileType: result.intermediate.fileType };
}

/** @deprecated */
export function isStructuredSpreadsheetFile(file) {
  const { extension } = detectVaultFileType(file);
  return isVaultParseableExtension(extension);
}
