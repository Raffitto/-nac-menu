/**
 * CK-3: Document chunking for Company Knowledge keyword search.
 * No OCR, embeddings, or semantic search — plain text chunks only.
 */

import {
  parseUploadedFile,
  isVaultParseableExtension,
  detectVaultFileType,
} from "../intelligence/askNac/vault/parsers/vaultFileAdapter";
import { computeTextContentHash } from "../intelligence/askNac/vault/vaultContentHash";

export const CHUNK_TARGET_CHARS = 5000;
export const CHUNK_MAX_CHARS = 7200;
export const CSV_ROWS_PER_CHUNK = 50;

const HEADING_LINE =
  /^(?:[0-9]+(?:\.[0-9]+)*[.)]?\s+)?[A-Z][A-Za-z0-9\s/&-]{2,80}$/;

/**
 * Split long text into paragraph-aware chunks (~800–1200 words equivalent).
 */
export function splitTextIntoChunks(text, { pageNo = null, sectionLabel = null } = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n|\r\n\r\n/).filter((p) => p.trim());
  if (!paragraphs.length) {
    return [
      {
        chunkIndex: 0,
        chunkText: normalized.slice(0, CHUNK_MAX_CHARS),
        pageNo,
        sectionLabel,
      },
    ];
  }

  const chunks = [];
  let buffer = "";
  let chunkIndex = 0;

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({ chunkIndex, chunkText: trimmed, pageNo, sectionLabel });
    chunkIndex += 1;
    buffer = "";
  };

  for (const para of paragraphs) {
    const next = buffer ? `${buffer}\n\n${para}` : para;
    if (next.length > CHUNK_MAX_CHARS && buffer.length >= CHUNK_TARGET_CHARS * 0.4) {
      flush();
      buffer = para;
    } else if (next.length > CHUNK_MAX_CHARS) {
      for (let i = 0; i < para.length; i += CHUNK_MAX_CHARS) {
        chunks.push({
          chunkIndex,
          chunkText: para.slice(i, i + CHUNK_MAX_CHARS).trim(),
          pageNo,
          sectionLabel,
        });
        chunkIndex += 1;
      }
      buffer = "";
    } else {
      buffer = next;
    }
  }

  flush();
  return chunks;
}

/** Detect DOCX-style heading lines from plain text. */
export function detectHeadingSections(lines = []) {
  const sections = [];
  let current = { sectionLabel: null, lines: [] };

  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const isHeading =
      HEADING_LINE.test(line) &&
      line.length < 80 &&
      !/[.!?]$/.test(line);

    if (isHeading && current.lines.length) {
      sections.push(current);
      current = { sectionLabel: line, lines: [] };
    } else if (isHeading && !current.lines.length) {
      current.sectionLabel = line;
    } else {
      current.lines.push(line);
    }
  }

  if (current.lines.length || current.sectionLabel) {
    sections.push(current);
  }

  return sections.length ? sections : [{ sectionLabel: null, lines: lines.filter(Boolean) }];
}

export function buildCsvChunks(matrix = []) {
  if (!matrix.length) return [];
  const header = (matrix[0] || []).map(String).join(" | ");
  const chunks = [];
  let chunkIndex = 0;

  for (let i = 1; i < matrix.length; i += CSV_ROWS_PER_CHUNK) {
    const rows = matrix.slice(i, i + CSV_ROWS_PER_CHUNK);
    const body = rows
      .map((row) => (Array.isArray(row) ? row.map(String).join(" | ") : String(row)))
      .join("\n");
    const chunkText = `Header: ${header}\n\n${body}`.trim();
    chunks.push({
      chunkIndex,
      chunkText,
      sectionLabel: `Rows ${i}–${Math.min(i + CSV_ROWS_PER_CHUNK - 1, matrix.length - 1)}`,
      pageNo: null,
    });
    chunkIndex += 1;
  }

  if (matrix.length === 1) {
    chunks.push({
      chunkIndex: 0,
      chunkText: `Header: ${header}`,
      sectionLabel: "Header only",
      pageNo: null,
    });
  }

  return chunks;
}

export function buildXlsxChunks(sections = []) {
  const chunks = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sheetLabel = section.label || section.id || "Sheet";
    const text = Array.isArray(section.lines)
      ? section.lines.join("\n")
      : String(section.text || "");
    const sheetChunks = splitTextIntoChunks(text, { sectionLabel: sheetLabel });
    for (const piece of sheetChunks) {
      chunks.push({ ...piece, chunkIndex, sectionLabel: piece.sectionLabel || sheetLabel });
      chunkIndex += 1;
    }
    if (!sheetChunks.length && text.trim()) {
      chunks.push({
        chunkIndex,
        chunkText: text.trim(),
        sectionLabel: sheetLabel,
        pageNo: null,
      });
      chunkIndex += 1;
    }
  }

  return chunks;
}

export function buildPdfChunks(sections = []) {
  const chunks = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const pageNo = section.pageNo ?? null;
    const text = section.text || (section.lines || []).join("\n");
    const pageChunks = splitTextIntoChunks(text, {
      pageNo,
      sectionLabel: section.label || (pageNo ? `Page ${pageNo}` : null),
    });
    for (const piece of pageChunks) {
      chunks.push({ ...piece, chunkIndex });
      chunkIndex += 1;
    }
  }

  return chunks;
}

export function buildDocxChunks(intermediate) {
  const lines = intermediate?.text?.split(/\r?\n/) || [];
  const sections = detectHeadingSections(lines);
  const chunks = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const text = section.lines.join("\n");
    const sectionChunks = splitTextIntoChunks(text, {
      sectionLabel: section.sectionLabel,
    });
    for (const piece of sectionChunks) {
      chunks.push({ ...piece, chunkIndex });
      chunkIndex += 1;
    }
  }

  return chunks;
}

/**
 * Build chunk records from parsed intermediate payload.
 */
export function buildChunksFromIntermediate(intermediate) {
  if (!intermediate) return [];

  const fileType = String(intermediate.fileType || intermediate.extension || "").toLowerCase();

  switch (fileType) {
    case "csv":
      return buildCsvChunks(intermediate.matrix || []);
    case "xlsx":
    case "xls":
      return buildXlsxChunks(intermediate.sections || []);
    case "pdf":
      return buildPdfChunks(intermediate.sections || []);
    case "docx":
      return buildDocxChunks(intermediate);
    case "txt":
    default:
      return splitTextIntoChunks(intermediate.text || "");
  }
}

/**
 * @param {File|Blob} file
 * @param {{ reportType?: string }} metadata
 */
export async function buildChunksFromFile(file, metadata = {}) {
  const { extension } = detectVaultFileType(file);
  if (!isVaultParseableExtension(extension)) {
    return { ok: false, chunks: [], error: `Unsupported file type ".${extension}" for chunking.` };
  }

  const parsed = await parseUploadedFile(file, metadata);
  if (!parsed.ok || !parsed.intermediate) {
    return { ok: false, chunks: [], error: parsed.error || "File extraction failed." };
  }

  const chunks = buildChunksFromIntermediate(parsed.intermediate);
  return { ok: chunks.length > 0, chunks, intermediate: parsed.intermediate, error: null };
}

function fileMetadataForChunks(fileRecord = {}) {
  return {
    branchId: fileRecord.primary_branch_id || fileRecord.primaryBranchId || null,
    department: fileRecord.department || null,
    reportType: fileRecord.report_type || fileRecord.reportType || null,
    sensitivityLevel: fileRecord.sensitivity_level || fileRecord.sensitivityLevel || "internal",
    dataLayer: fileRecord.data_layer || fileRecord.dataLayer || "unknown",
    periodStart: fileRecord.period_start || fileRecord.periodStart || null,
    periodEnd: fileRecord.period_end || fileRecord.periodEnd || null,
  };
}

/**
 * Persist chunks to ask_nac_document_chunks and update file search status.
 */
export async function persistVaultDocumentChunks(
  supabase,
  { fileId, fileVersionId = null, fileRecord = {}, chunks = [] },
) {
  if (!supabase || !fileId) {
    return { ok: false, chunkCount: 0, error: "Supabase client and fileId are required." };
  }

  const meta = fileMetadataForChunks(fileRecord);

  await supabase.from("ask_nac_document_chunks").delete().eq("file_id", fileId);

  if (!chunks.length) {
    await supabase
      .from("ask_nac_files")
      .update({
        chunk_count: 0,
        search_status: "not_searchable",
        searchable_at: null,
      })
      .eq("id", fileId);

    return { ok: true, chunkCount: 0, error: null };
  }

  const rows = [];
  for (const chunk of chunks) {
    const chunkText = String(chunk.chunkText || "").trim();
    if (!chunkText) continue;
    const contentHash = await computeTextContentHash(chunkText);
    rows.push({
      file_id: fileId,
      file_version_id: fileVersionId,
      chunk_index: chunk.chunkIndex ?? rows.length,
      chunk_text: chunkText,
      page_no: chunk.pageNo ?? null,
      section_label: chunk.sectionLabel ?? null,
      branch_id: meta.branchId,
      department: meta.department,
      report_type: meta.reportType,
      sensitivity_level: meta.sensitivityLevel,
      data_layer: meta.dataLayer,
      period_start: meta.periodStart,
      period_end: meta.periodEnd,
      content_hash: contentHash,
    });
  }

  if (!rows.length) {
    await supabase
      .from("ask_nac_files")
      .update({
        chunk_count: 0,
        search_status: "not_searchable",
        searchable_at: null,
      })
      .eq("id", fileId);
    return { ok: true, chunkCount: 0, error: null };
  }

  const { error: insertError } = await supabase.from("ask_nac_document_chunks").insert(rows);
  if (insertError) {
    await supabase
      .from("ask_nac_files")
      .update({ search_status: "failed", chunk_count: 0, searchable_at: null })
      .eq("id", fileId);
    return { ok: false, chunkCount: 0, error: insertError.message };
  }

  const searchableAt = new Date().toISOString();
  await supabase
    .from("ask_nac_files")
    .update({
      chunk_count: rows.length,
      search_status: "searchable",
      searchable_at: searchableAt,
    })
    .eq("id", fileId);

  return { ok: true, chunkCount: rows.length, searchableAt, error: null };
}

/**
 * Extract, chunk, and persist document text for keyword search.
 */
export async function runVaultDocumentChunking(
  supabase,
  { file, fileRecord, fileId, versionRowId = null, jobId = null },
) {
  if (!supabase || !file || !fileId) {
    return { ok: false, chunkCount: 0, error: "Missing supabase, file, or fileId." };
  }

  await supabase
    .from("ask_nac_files")
    .update({ search_status: "indexing" })
    .eq("id", fileId);

  const built = await buildChunksFromFile(file, {
    reportType: fileRecord?.report_type || fileRecord?.reportType,
  });

  if (!built.ok) {
    await supabase
      .from("ask_nac_files")
      .update({ search_status: "not_searchable", chunk_count: 0, searchable_at: null })
      .eq("id", fileId);

    if (jobId) {
      await supabase
        .from("ask_nac_ingestion_jobs")
        .update({
          stats: {
            chunkCount: 0,
            searchStatus: "not_searchable",
            chunkError: built.error,
          },
        })
        .eq("id", jobId);
    }

    return { ok: false, chunkCount: 0, error: built.error };
  }

  const persisted = await persistVaultDocumentChunks(supabase, {
    fileId,
    fileVersionId: versionRowId,
    fileRecord,
    chunks: built.chunks,
  });

  if (jobId) {
    await supabase
      .from("ask_nac_ingestion_jobs")
      .update({
        stats: {
          chunkCount: persisted.chunkCount,
          searchStatus: persisted.ok && persisted.chunkCount > 0 ? "searchable" : "not_searchable",
        },
      })
      .eq("id", jobId);
  }

  return persisted;
}
