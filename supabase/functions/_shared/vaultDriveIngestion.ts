import { sanitizeErrorMessage } from "./vaultDriveSecrets.ts";
import {
  attachCashUpWorkbookFactContext,
  parseCashUpWorkbookFromXlsxBuffer,
  validateCashUpWorkbookParse,
  type CashUpWorkbookParseResult,
} from "./vaultCashUpWorkbookParser.ts";
import {
  attachWeeklyDashboardFactContext,
  parseWeeklyDashboardFromText,
  parseWeeklyDashboardFromXlsxBuffer,
  validateWeeklyDashboardParse,
} from "./vaultWeeklyDashboardParser.ts";
import { replaceStructuredFactsForFile } from "./vaultStructuredFactsReplace.ts";
import {
  classifyDrivePath,
  fetchActiveDiscoveryRules,
  shouldIngestDiscoveryDecision,
} from "./driveDiscoveryClassifier.ts";
import { ensureIngestionEntities } from "./entityRegistry.ts";
import {
  buildCompilerProfile,
  completeCompilerStage,
  failCompilerStage,
  initializeCompilerJobObservability,
  setCompilerManifest,
  startCompilerStage,
} from "./compilerStageTracking.ts";

const VAULT_STORAGE_BUCKET = "ask-nac-vault-originals";
const CHUNK_TARGET_CHARS = 5000;
const CHUNK_MAX_CHARS = 7200;
const PARSEABLE_REPORT_TYPES = new Set([
  "cash_up",
  "reception_daily_report",
  "daily_logbook",
  "daily_briefing",
  "ccm_reconciliation",
  "weekly_sales_overview",
  "weekly_dashboard",
  "pnl",
]);

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_PRESENTATION_MIME = "application/vnd.google-apps.presentation";
const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_DRIVE_FOLDER_DEPTH = 20;
const MAX_DRIVE_ITEMS_PER_RUN = 5000;
const DEFAULT_MAX_FILES_TO_PROCESS = 50;
const DRIVE_FETCH_TIMEOUT_MS = 15000;
const DB_OPERATION_TIMEOUT_MS = 10000;

const SUPPORTED_BINARY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "text/plain": "txt",
};

type SupabaseLike = {
  from: (table: string) => any;
  storage: { from: (bucket: string) => any };
};

type DriveFolder = {
  id: string;
  connection_id: string;
  drive_folder_id: string;
  folder_name?: string | null;
  label?: string | null;
  default_branch_id?: string | null;
  default_department?: string | null;
  branch_id?: string | null;
  department?: string | null;
  report_type?: string | null;
  sensitivity?: string | null;
  auto_ingest?: boolean | null;
  is_discovery_root?: boolean | null;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
  version?: string;
  webViewLink?: string;
  parents?: string[];
  driveId?: string;
};

type DriveFolderInfo = DriveFile & {
  trashed?: boolean;
  capabilities?: Record<string, unknown>;
};

type DriveFileWithPath = DriveFile & {
  folderPath: string;
  relativePath: string;
  depth: number;
};

type RunCounters = {
  discovered_count: number;
  new_count: number;
  changed_count: number;
  skipped_count: number;
  downloaded_count: number;
  extracted_count: number;
  parsed_count: number;
  indexed_count: number;
  failed_count: number;
};

function nowIso() {
  return new Date().toISOString();
}

function safeName(name: string) {
  return String(name || "drive-file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 140);
}

function extensionFromName(name: string) {
  const lower = String(name || "").toLowerCase();
  if (!lower.includes(".")) return "";
  return lower.slice(lower.lastIndexOf(".") + 1);
}

function normalizeFolderMetadata(folder: DriveFolder) {
  const branchId = folder.branch_id || folder.default_branch_id || null;
  const department = folder.department || folder.default_department || "operations";
  const folderLabel = `${folder.folder_name || ""} ${folder.label || ""}`;
  const reportType = /\bcash[\s-]?up|cashup|daily cash report|monthly cash safe\b/i.test(folderLabel)
    ? "cash_up"
    : /\bweekly dashboards?\b|\bexecutive reports?\b.*\bweekly\b/i.test(folderLabel)
      ? "weekly_dashboard"
      : folder.report_type || "other";
  const sensitivity = folder.sensitivity || "internal";
  return { branchId, department, reportType, sensitivity };
}

function resolveDriveFileReportType(
  folder: DriveFolder,
  driveFile: DriveFileWithPath,
  fallback: string,
  discoveryDecision?: { vaultReportType?: string | null } | null,
) {
  if (discoveryDecision?.vaultReportType) return discoveryDecision.vaultReportType;
  const text = `${folder.folder_name || ""} ${folder.label || ""} ${driveFile.folderPath || ""} ${driveFile.relativePath || ""} ${driveFile.name || ""}`;
  if (/\bcash[\s-]?up|cashup|daily cash report\b/i.test(text)) return "cash_up";
  if (/\bweekly dashboards?\b|\bexecutive reports?\b.*\bweekly\b|\bweekly\b.*\bexecutive reports?\b/i.test(text)) {
    return "weekly_dashboard";
  }
  if (/\bdaily briefing\b|\bbriefing\b/i.test(text)) return "daily_briefing";
  if (/\bdaily reception\b/i.test(text)) return "reception_daily_report";
  if (/\bbreakage\b/i.test(text)) return "breakage_report";
  if (/\bdiscount\b|\bcomp\b|\bvoids?\b/i.test(text)) return "discount_void_comp";
  if (/\bguest feedback\b/i.test(text)) return "guest_feedback";
  return fallback || "other";
}

function folderRootLabel(folder: DriveFolder) {
  return String(folder.label || folder.folder_name || folder.drive_folder_id || "Google Drive").trim();
}

function joinDrivePath(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" / ");
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeoutId) };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new DriveIngestionError("operation_timeout", `${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function driveFetch(url: string, init: RequestInit, label: string) {
  const timeout = timeoutSignal(DRIVE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: timeout.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new DriveIngestionError("drive_request_timeout", `${label} timed out after ${DRIVE_FETCH_TIMEOUT_MS}ms.`);
    }
    throw err;
  } finally {
    timeout.clear();
  }
}

class DriveIngestionError extends Error {
  code: string;
  httpStatus?: number;

  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = "DriveIngestionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function errorCode(err: unknown) {
  if (err instanceof DriveIngestionError) return err.code;
  return "drive_ingestion_error";
}

async function driveJson(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = sanitizeErrorMessage(data?.error?.message || data?.error_description || fallback);
    const status = res.status;
    const code =
      status === 401 ? "drive_token_invalid" :
      status === 403 ? "drive_permission_denied" :
      status === 404 ? "drive_folder_not_found" :
      "drive_api_error";
    throw new DriveIngestionError(code, message, status);
  }
  return data;
}

function resolveDriveExport(file: DriveFile) {
  if (file.mimeType === GOOGLE_DOC_MIME) {
    return {
      exportMime: "text/plain",
      filename: file.name.toLowerCase().endsWith(".txt") ? file.name : `${file.name}.txt`,
      outputMime: "text/plain",
      extension: "txt",
    };
  }
  if (file.mimeType === GOOGLE_SHEET_MIME) {
    return {
      exportMime: "text/csv",
      filename: file.name.toLowerCase().endsWith(".csv") ? file.name : `${file.name}.csv`,
      outputMime: "text/csv",
      extension: "csv",
    };
  }
  if (file.mimeType === GOOGLE_PRESENTATION_MIME) {
    return { unsupported: "Google Slides ingestion is not supported yet." };
  }

  const extension = SUPPORTED_BINARY_MIME[file.mimeType] || extensionFromName(file.name);
  if (!["pdf", "docx", "xlsx", "xls", "csv", "txt"].includes(extension)) {
    return { unsupported: `Unsupported Drive file type: ${file.mimeType || extension || "unknown"}.` };
  }
  return {
    filename: file.name,
    outputMime: file.mimeType || "application/octet-stream",
    extension,
  };
}

export async function listDriveFiles(accessToken: string, folderId: string, pageToken?: string) {
  const query = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size,webViewLink,parents,driveId,version)",
    pageSize: "1000",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, `Drive list for folder ${folderId}`);
  const data = await driveJson(res, "Drive list failed");
  return { ...data, query };
}

export async function verifyDriveFolderAccess(accessToken: string, folderId: string) {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,trashed,driveId,parents,capabilities",
    supportsAllDrives: "true",
  });
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${folderId}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, `Drive folder verification for ${folderId}`);
  const data = await driveJson(res, "Drive folder lookup failed") as DriveFolderInfo;
  if (data.mimeType !== GOOGLE_FOLDER_MIME) {
    throw new DriveIngestionError(
      "drive_folder_id_invalid",
      `Registered Drive ID is not a folder (${data.mimeType || "unknown"}).`,
    );
  }
  if (data.trashed) {
    throw new DriveIngestionError("drive_folder_trashed", "Registered Drive folder is trashed.");
  }
  return data;
}

export async function walkDriveFolderTree(
  accessToken: string,
  {
    rootFolderId,
    rootLabel,
    maxDepth = MAX_DRIVE_FOLDER_DEPTH,
    maxItems = MAX_DRIVE_ITEMS_PER_RUN,
    onFolderScanned,
    onFirstListResponse,
  }: {
    rootFolderId: string;
    rootLabel: string;
    maxDepth?: number;
    maxItems?: number;
    onFolderScanned?: (info: {
      folderId: string;
      folderPath: string;
      depth: number;
      foldersScanned: number;
      maxDepth: number;
    }) => Promise<void> | void;
    onFirstListResponse?: (info: {
      folderId: string;
      folderPath: string;
      fileCount: number;
      nextPageToken: boolean;
      sample: Array<{ id: string; name: string; mimeType: string }>;
    }) => Promise<void> | void;
  },
) {
  const files: DriveFileWithPath[] = [];
  const visitedFolderIds = new Set<string>();
  const seenFileIds = new Set<string>();
  const queue: Array<{ folderId: string; folderPath: string; depth: number }> = [
    { folderId: rootFolderId, folderPath: rootLabel, depth: 0 },
  ];
  let foldersScanned = 0;
  let maxDepthSeen = 0;
  let duplicateCount = 0;
  let truncated = false;
  let firstListLogged = false;

  while (queue.length) {
    const current = queue.shift()!;
    if (visitedFolderIds.has(current.folderId)) continue;
    visitedFolderIds.add(current.folderId);
    foldersScanned += 1;
    maxDepthSeen = Math.max(maxDepthSeen, current.depth);
    await onFolderScanned?.({
      folderId: current.folderId,
      folderPath: current.folderPath,
      depth: current.depth,
      foldersScanned,
      maxDepth: maxDepthSeen,
    });

    let pageToken: string | undefined;
    do {
      const listing = await listDriveFiles(accessToken, current.folderId, pageToken);
      if (!firstListLogged) {
        const firstList = {
          folderId: current.folderId,
          folderPath: current.folderPath,
          status: "ok",
          fileCount: listing.files?.length || 0,
          files_count: listing.files?.length || 0,
          nextPageToken: Boolean(listing.nextPageToken),
          query: listing.query,
          sample: (listing.files || []).slice(0, 5).map((file: DriveFile) => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
          })),
        };
        console.info("[vault-drive-ingest] first Drive list response", firstList);
        await onFirstListResponse?.(firstList);
        firstListLogged = true;
      }
      for (const item of listing.files || []) {
        if (item.mimeType === GOOGLE_FOLDER_MIME) {
          if (current.depth + 1 <= maxDepth && !visitedFolderIds.has(item.id)) {
            queue.push({
              folderId: item.id,
              folderPath: joinDrivePath([current.folderPath, item.name]),
              depth: current.depth + 1,
            });
          }
          continue;
        }

        if (seenFileIds.has(item.id)) {
          duplicateCount += 1;
          continue;
        }
        seenFileIds.add(item.id);
        files.push({
          ...item,
          folderPath: current.folderPath,
          relativePath: joinDrivePath([current.folderPath, item.name]),
          depth: current.depth,
        });

        if (files.length >= maxItems) {
          truncated = true;
          queue.length = 0;
          break;
        }
      }
      if (truncated) break;
      pageToken = listing.nextPageToken;
    } while (pageToken);
  }

  return {
    files,
    foldersScanned,
    maxDepth: maxDepthSeen,
    duplicateCount,
    truncated,
  };
}

async function getDriveFile(accessToken: string, driveFileId: string) {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,modifiedTime,size,md5Checksum,version",
    supportsAllDrives: "true",
  });
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, `Drive file lookup for ${driveFileId}`);
  const data = await res.json();
  if (!res.ok) throw new DriveIngestionError(
    res.status === 401 ? "drive_token_invalid" :
    res.status === 403 ? "drive_permission_denied" :
    res.status === 404 ? "drive_file_not_found" :
    "drive_api_error",
    sanitizeErrorMessage(data.error?.message || "Drive file lookup failed"),
    res.status,
  );
  return data as DriveFile;
}

async function downloadDriveFile(accessToken: string, driveFile: DriveFile) {
  const exportInfo = resolveDriveExport(driveFile);
  if ("unsupported" in exportInfo) {
    throw new Error(exportInfo.unsupported);
  }

  const url = exportInfo.exportMime
    ? `https://www.googleapis.com/drive/v3/files/${driveFile.id}/export?mimeType=${encodeURIComponent(exportInfo.exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media&supportsAllDrives=true`;
  const res = await driveFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }, `Drive download for ${driveFile.id}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(sanitizeErrorMessage(text || `Drive download failed (${res.status})`));
  }
  const buffer = await res.arrayBuffer();
  return {
    buffer,
    filename: exportInfo.filename,
    mimeType: exportInfo.outputMime,
    extension: exportInfo.extension,
    size: buffer.byteLength,
  };
}

async function sha256Hex(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function textLinesToMatrix(lines: string[]) {
  const matrix: string[][] = [];
  for (const line of lines || []) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    if (trimmed.includes("\t")) matrix.push(trimmed.split("\t").map((c) => c.trim()));
    else if (trimmed.includes("|")) matrix.push(trimmed.split("|").map((c) => c.trim()));
    else if (trimmed.includes(",")) matrix.push(trimmed.split(",").map((c) => c.trim()));
    else matrix.push([trimmed]);
  }
  return matrix;
}

const CASH_UP_FACT_LABELS: Record<string, RegExp[]> = {
  business_date: [/\b(business date|date|trading date)\b/i],
  total_sales: [/\b(total sales|gross sales|gross revenue|sales total)\b/i],
  net_sales: [/\b(net sales|net total|net revenue)\b/i],
  cash_sales: [/\b(cash sales|cash total|cash payment|cash tender|cash collected)\b/i],
  card_sales: [/\b(card sales|card total|mada|visa|mastercard|credit card|debit card)\b/i],
  delivery_sales: [/\b(delivery sales|delivery total|aggregator sales|hungerstation|jahez|keeta|talabat)\b/i],
  discounts: [/\b(discounts?|discount total|total discounts?)\b/i],
  voids: [/\b(voids?|void total|total voids?)\b/i],
  refunds: [/\b(refunds?|refund total|total refunds?)\b/i],
  guest_count: [/\b(guests?|guest count|covers|pax)\b/i],
  order_count: [/\b(orders?|order count|tickets?)\b/i],
  cash_variance: [/\b(cash variance|over\/short|over short|variance|difference)\b/i],
};

function parseNumberValue(raw: unknown) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const cleaned = String(raw ?? "")
    .replace(/[,]/g, "")
    .replace(/\b(SAR|SR|riyals?|ر\.س)\b/gi, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function normalizeIsoDate(year: number, month: number, day: number) {
  if (!year || !month || !day) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

function parseBusinessDate(text = "", referenceDate = new Date()) {
  const value = String(text || "");
  const iso = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return normalizeIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (dmy) return normalizeIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthToken =
    "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const named = value.match(new RegExp(`\\b(\\d{1,2})\\s+${monthToken}(?:\\s+(20\\d{2}))?\\b`, "i"));
  if (named) {
    const year = named[3] ? Number(named[3]) : resolveBusinessYear(months[named[2].toLowerCase()], named[3], referenceDate);
    return normalizeIsoDate(year, months[named[2].toLowerCase()], Number(named[1]));
  }
  const monthDay = value.match(new RegExp(`\\b${monthToken}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(20\\d{2}))?\\b`, "i"));
  if (monthDay) {
    const year = monthDay[3] ? Number(monthDay[3]) : resolveBusinessYear(months[monthDay[1].toLowerCase()], monthDay[3], referenceDate);
    return normalizeIsoDate(year, months[monthDay[1].toLowerCase()], Number(monthDay[2]));
  }
  const glued = value.match(new RegExp(`\\b(\\d{1,2})${monthToken}(?:\\s+(20\\d{2}))?\\b`, "i"));
  if (glued) {
    const year = glued[3] ? Number(glued[3]) : resolveBusinessYear(months[glued[2].toLowerCase()], glued[3], referenceDate);
    return normalizeIsoDate(year, months[glued[2].toLowerCase()], Number(glued[1]));
  }
  return null;
}

function resolveBusinessYear(monthIndex: number, explicitYear: string | undefined, referenceDate: Date) {
  if (explicitYear) return Number(explicitYear);
  let year = referenceDate.getUTCFullYear();
  if (monthIndex - 1 > referenceDate.getUTCMonth()) year -= 1;
  return year;
}

function resolveDriveBusinessPeriod(
  text: string,
  fileRow: Record<string, any>,
  referenceDate = new Date(),
) {
  return (
    parseBusinessDate(text, referenceDate)
    || parseBusinessDate(fileRow.original_filename || fileRow.title || "", referenceDate)
    || fileRow.period_start
    || null
  );
}

function rowContainsLabel(row: string[], patterns: RegExp[]) {
  return row.some((cell) => patterns.some((pattern) => pattern.test(String(cell || ""))));
}

function numberFromRow(row: string[], labelIndex: number) {
  const ordered = [
    ...row.slice(labelIndex + 1),
    ...row.slice(0, labelIndex),
  ];
  for (const cell of ordered) {
    const value = parseNumberValue(cell);
    if (value != null) return value;
  }
  return null;
}

function extractCashUpStructuredFacts(matrix: string[][], fileRow: Record<string, any>, versionRowId: string | null, email: string) {
  const rows: Record<string, any>[] = [];
  const joinedText = matrix.map((row) => row.join(" | ")).join("\n");
  const businessDate = parseBusinessDate(joinedText) || parseBusinessDate(fileRow.title || fileRow.original_filename || "");
  const periodStart = businessDate || fileRow.period_start || null;
  const periodEnd = businessDate || fileRow.period_end || null;
  const seen = new Set<string>();

  const addFact = (metricKey: string, metricValue: number | null, dimensions: Record<string, unknown> = {}, rowIndex: number | null = null) => {
    const signature = `${metricKey}:${JSON.stringify(dimensions)}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    rows.push({
      file_id: fileRow.id,
      file_version_id: versionRowId,
      branch_id: fileRow.primary_branch_id,
      brand_wide: fileRow.brand_wide,
      department: fileRow.department,
      report_type: fileRow.report_type,
      sensitivity_level: fileRow.sensitivity_level,
      metric_key: metricKey,
      metric_value: metricValue,
      dimensions,
      period_start: periodStart,
      period_end: periodEnd,
      grain: "daily",
      source_row_ref: rowIndex != null ? `drive-row-${rowIndex + 1}` : "drive-cash-up-parser",
      confidence: 0.72,
      created_by: email,
    });
  };

  if (businessDate) addFact("business_date", null, { text_value: businessDate });

  matrix.forEach((row, rowIndex) => {
    for (const [metricKey, patterns] of Object.entries(CASH_UP_FACT_LABELS)) {
      const labelIndex = row.findIndex((cell) => patterns.some((pattern) => pattern.test(String(cell || ""))));
      if (labelIndex < 0 || metricKey === "business_date") continue;
      const value = numberFromRow(row, labelIndex);
      if (value == null) continue;
      addFact(metricKey, value, {}, rowIndex);
      if (metricKey === "cash_sales") addFact("payment_method", value, { method: "cash" }, rowIndex);
      if (metricKey === "card_sales") addFact("payment_method", value, { method: "card" }, rowIndex);
      if (metricKey === "delivery_sales" && rowContainsLabel(row, CASH_UP_FACT_LABELS.delivery_sales)) {
        const label = String(row[labelIndex] || "").toLowerCase();
        const platform = label.match(/\b(hungerstation|jahez|keeta|talabat)\b/)?.[1] || "delivery";
        addFact("delivery_sales", value, { platform }, rowIndex);
      }
    }
  });

  return rows;
}

async function extractText(download: { buffer: ArrayBuffer; extension: string; filename: string }) {
  const extension = download.extension.toLowerCase();
  if (extension === "txt" || extension === "csv") {
    const text = new TextDecoder().decode(download.buffer);
    return { text, sections: [{ label: extension.toUpperCase(), text }], warnings: [] as string[] };
  }

  if (extension === "xlsx" || extension === "xls") {
    const XLSX = await import("npm:xlsx@0.18.5");
    const workbook = XLSX.read(download.buffer, { type: "array" });
    const sections = workbook.SheetNames.map((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
      const text = matrix
        .map((row) => (Array.isArray(row) ? row.map(String).filter(Boolean).join(" | ") : ""))
        .filter(Boolean)
        .join("\n");
      return { label: sheetName, text };
    });
    return {
      text: sections.map((section) => `[${section.label}]\n${section.text}`).join("\n\n"),
      sections,
      warnings: [] as string[],
    };
  }

  if (extension === "docx") {
    const mammoth = await import("npm:mammoth@1.12.0");
    const arrayBuffer = download.buffer instanceof ArrayBuffer
      ? download.buffer
      : new Uint8Array(download.buffer as ArrayBufferLike).buffer;
    const result = await mammoth.extractRawText({ arrayBuffer });
    return {
      text: String(result.value || ""),
      sections: [{ label: "Document text", text: String(result.value || "") }],
      warnings: (result.messages || []).map((m: { message?: string }) => m.message).filter(Boolean).slice(0, 3),
    };
  }

  if (extension === "pdf") {
    const pdfjs = await import("npm:pdfjs-dist@3.11.174/legacy/build/pdf.js");
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = "";
    const task = pdfjs.getDocument({
      data: new Uint8Array(download.buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const doc = await task.promise;
    const sections: Array<{ label: string; text: string; pageNo: number }> = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: { str?: string }) => item.str || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) sections.push({ label: `Page ${pageNo}`, pageNo, text });
    }
    return { text: sections.map((s) => s.text).join("\n"), sections, warnings: [] as string[] };
  }

  throw new Error(`Unsupported extracted file extension ".${extension}".`);
}

function splitTextIntoChunks(text: string, sectionLabel: string | null = null, startIndex = 0) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\s*\n|\r\n\r\n/).filter((p) => p.trim());
  const chunks: Array<{ chunkIndex: number; chunkText: string; sectionLabel: string | null }> = [];
  let buffer = "";
  let chunkIndex = startIndex;

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({ chunkIndex, chunkText: trimmed, sectionLabel });
    chunkIndex += 1;
    buffer = "";
  };

  for (const para of paragraphs.length ? paragraphs : [normalized]) {
    const next = buffer ? `${buffer}\n\n${para}` : para;
    if (next.length > CHUNK_MAX_CHARS && buffer.length >= CHUNK_TARGET_CHARS * 0.4) {
      flush();
      buffer = para;
    } else if (next.length > CHUNK_MAX_CHARS) {
      for (let i = 0; i < para.length; i += CHUNK_MAX_CHARS) {
        chunks.push({ chunkIndex, chunkText: para.slice(i, i + CHUNK_MAX_CHARS).trim(), sectionLabel });
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

function buildChunks(extracted: { text: string; sections: Array<{ label?: string; text?: string }> }) {
  const chunks: Array<{ chunkIndex: number; chunkText: string; sectionLabel: string | null }> = [];
  const sections = extracted.sections?.length ? extracted.sections : [{ label: "Document", text: extracted.text }];
  for (const section of sections) {
    const sectionChunks = splitTextIntoChunks(section.text || "", section.label || null, chunks.length);
    chunks.push(...sectionChunks);
  }
  return chunks.length ? chunks : splitTextIntoChunks(extracted.text || "", null, 0);
}

const CHUNK_INSERT_BATCH_SIZE = 40;

async function persistChunks(
  admin: SupabaseLike,
  {
    fileId,
    versionRowId,
    fileRow,
    chunks,
  }: {
    fileId: string;
    versionRowId: string | null;
    fileRow: Record<string, any>;
    chunks: Array<{ chunkIndex: number; chunkText: string; sectionLabel: string | null }>;
  },
) {
  await admin.from("ask_nac_document_chunks").delete().eq("file_id", fileId);
  if (!chunks.length) {
    await admin
      .from("ask_nac_files")
      .update({ chunk_count: 0, search_status: "not_searchable", searchable: false, searchable_at: null })
      .eq("id", fileId);
    return 0;
  }

  const hashes = await Promise.all(
    chunks.map(async (chunk) => {
      const chunkText = String(chunk.chunkText || "").trim();
      if (!chunkText) return null;
      return {
        file_id: fileId,
        file_version_id: versionRowId,
        chunk_index: chunk.chunkIndex,
        chunk_text: chunkText,
        section_label: chunk.sectionLabel,
        branch_id: fileRow.primary_branch_id,
        department: fileRow.department,
        report_type: fileRow.report_type,
        sensitivity_level: fileRow.sensitivity_level,
        data_layer: fileRow.data_layer,
        period_start: fileRow.period_start,
        period_end: fileRow.period_end,
        content_hash: await sha256Hex(chunkText),
      };
    }),
  );
  const rows = hashes.filter(Boolean) as Array<Record<string, unknown>>;

  if (!rows.length) return 0;

  // Batch inserts so one oversized workbook cannot stall a single PostgREST write.
  for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const slice = rows.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
    const { error } = await admin.from("ask_nac_document_chunks").insert(slice);
    if (error) throw new Error(error.message);
  }

  await admin
    .from("ask_nac_files")
    .update({
      chunk_count: rows.length,
      search_status: "searchable",
      searchable: true,
      searchable_at: nowIso(),
    })
    .eq("id", fileId);
  return rows.length;
}

async function createFileVersion(
  admin: SupabaseLike,
  { fileId, storagePath, contentHash, sizeBytes, mimeType }: {
    fileId: string;
    storagePath: string;
    contentHash: string;
    sizeBytes: number;
    mimeType: string | null;
  },
) {
  const { data: latest } = await admin
    .from("ask_nac_file_versions")
    .select("id,version_no")
    .eq("file_id", fileId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionId = crypto.randomUUID();
  const versionNo = Number(latest?.version_no || 0) + 1;
  const { error } = await admin.from("ask_nac_file_versions").insert({
    id: versionId,
    file_id: fileId,
    version_no: versionNo,
    storage_path: storagePath,
    size_bytes: sizeBytes,
    mime_type: mimeType,
    content_hash: contentHash,
    supersedes_version_id: latest?.id || null,
  });
  if (error) throw new Error(error.message);
  return { id: versionId, version_no: versionNo };
}

type StructuredFactsResult = {
  factCount: number;
  stage: string;
  confidence: number | null;
  confidenceLevel: string | null;
  publish: boolean;
  parser: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
};

function isWeeklyDashboardSpreadsheet(reportType: string, extension: string) {
  const ext = String(extension || "").toLowerCase();
  return reportType === "weekly_dashboard" && (ext === "xlsx" || ext === "xls");
}

function isCashUpSpreadsheet(reportType: string, extension: string) {
  const ext = String(extension || "").toLowerCase();
  return reportType === "cash_up" && (ext === "xlsx" || ext === "xls");
}

async function persistParsedFacts(
  admin: SupabaseLike,
  {
    fileRow,
    versionRowId,
    email,
    rows,
    periodStart,
    periodEnd,
    minInserted,
    onBatch,
  }: {
    fileRow: Record<string, any>;
    versionRowId: string | null;
    email: string;
    rows: Record<string, unknown>[];
    periodStart: string | null;
    periodEnd: string | null;
    minInserted?: number;
    onBatch?: (info: { batchIndex: number; batchCount: number; insertedSoFar: number }) => Promise<void> | void;
  },
) {
  await replaceStructuredFactsForFile(admin, {
    fileId: fileRow.id,
    rows,
    periodStart,
    periodEnd,
    minInserted: minInserted ?? rows.length,
    onBatch,
  });
}

async function insertStructuredFacts(
  admin: SupabaseLike,
  {
    fileRow,
    versionRowId,
    text,
    email,
    download,
    onFactsBatch,
  }: {
    fileRow: Record<string, any>;
    versionRowId: string | null;
    text: string;
    email: string;
    download?: { buffer: ArrayBuffer; extension: string; filename: string };
    onFactsBatch?: (info: { batchIndex: number; batchCount: number; insertedSoFar: number }) => Promise<void> | void;
  },
): Promise<StructuredFactsResult> {
  if (!PARSEABLE_REPORT_TYPES.has(fileRow.report_type)) {
    return {
      factCount: 0,
      stage: "chunks_indexed",
      confidence: null,
      confidenceLevel: null,
      publish: false,
      parser: null,
      periodStart: null,
      periodEnd: null,
      warnings: [],
    };
  }

  if (isWeeklyDashboardSpreadsheet(fileRow.report_type, download?.extension || "")) {
    if (!download?.buffer) {
      throw new Error("Weekly dashboard spreadsheet parse failed — workbook buffer missing.");
    }
    const parsed = await parseWeeklyDashboardFromXlsxBuffer(download.buffer);
    if (!validateWeeklyDashboardParse(parsed)) {
      const textParsed = parseWeeklyDashboardFromText(text);
      if (!validateWeeklyDashboardParse(textParsed)) {
        throw new Error(parsed.error || textParsed.error || "Weekly dashboard parse failed — existing facts preserved.");
      }
      const rows = attachWeeklyDashboardFactContext(textParsed.facts, fileRow, versionRowId, email);
      await persistParsedFacts(admin, {
        fileRow,
        versionRowId,
        email,
        rows,
        periodStart: textParsed.periodStart,
        periodEnd: textParsed.periodEnd,
        minInserted: rows.length,
      });
      return {
        factCount: rows.length,
        stage: "weekly_dashboard_text_parsed",
        confidence: 0.72,
        confidenceLevel: "medium",
        publish: true,
        parser: textParsed.parser,
        periodStart: textParsed.periodStart,
        periodEnd: textParsed.periodEnd,
        warnings: [],
      };
    }
    const rows = attachWeeklyDashboardFactContext(parsed.facts, fileRow, versionRowId, email);
    await persistParsedFacts(admin, {
      fileRow,
      versionRowId,
      email,
      rows,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      minInserted: rows.length,
    });
    return {
      factCount: rows.length,
      stage: "weekly_dashboard_workbook_parsed",
      confidence: 0.82,
      confidenceLevel: "medium",
      publish: true,
      parser: parsed.parser,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      warnings: [],
    };
  }

  if (fileRow.report_type === "weekly_dashboard") {
    const parsed = parseWeeklyDashboardFromText(text);
    if (validateWeeklyDashboardParse(parsed)) {
      const rows = attachWeeklyDashboardFactContext(parsed.facts, fileRow, versionRowId, email);
      await persistParsedFacts(admin, {
        fileRow,
        versionRowId,
        email,
        rows,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        minInserted: rows.length,
      });
      return {
        factCount: rows.length,
        stage: "weekly_dashboard_text_parsed",
        confidence: 0.72,
        confidenceLevel: "medium",
        publish: true,
        parser: parsed.parser,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        warnings: [],
      };
    }
  }

  if (isCashUpSpreadsheet(fileRow.report_type, download?.extension || "")) {
    if (!download?.buffer) {
      throw new Error("Cash-up spreadsheet parse failed — workbook buffer missing.");
    }
    const parsed: CashUpWorkbookParseResult = await parseCashUpWorkbookFromXlsxBuffer(download.buffer);
    if (!validateCashUpWorkbookParse(parsed)) {
      throw new Error(parsed.error || "Cash-up workbook parse failed — existing facts preserved.");
    }
    const rows = attachCashUpWorkbookFactContext(parsed.facts, fileRow, versionRowId, email);
    await persistParsedFacts(admin, {
      fileRow,
      versionRowId,
      email,
      rows,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      minInserted: rows.length,
      onBatch: onFactsBatch,
    });
    return {
      factCount: rows.length,
      stage: "cash_up_workbook_parsed",
      confidence: 0.78,
      confidenceLevel: "medium",
      publish: true,
      parser: parsed.parser,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      warnings: [],
    };
  }

  const matrix = textLinesToMatrix(String(text || "").split(/\r?\n/));
  const resolvedPeriod = resolveDriveBusinessPeriod(text, fileRow);
  const periodStart = resolvedPeriod || fileRow.period_start || null;
  const periodEnd = resolvedPeriod || fileRow.period_end || fileRow.period_start || null;

  const cashUpFacts = fileRow.report_type === "cash_up"
    ? extractCashUpStructuredFacts(matrix, fileRow, versionRowId, email)
    : [];
  if (cashUpFacts.length) {
    const periodStart = cashUpFacts.find((fact) => fact.period_start)?.period_start || null;
    const periodEnd = cashUpFacts.find((fact) => fact.period_end)?.period_end || periodStart;
    if (!periodStart || !periodEnd) {
      throw new Error("Cash-up text parse produced facts without period_end — existing facts preserved.");
    }
    await persistParsedFacts(admin, {
      fileRow,
      versionRowId,
      email,
      rows: cashUpFacts,
      periodStart,
      periodEnd,
    });
    return {
      factCount: cashUpFacts.length,
      stage: "raw_extract_only",
      confidence: 0.35,
      confidenceLevel: "low",
      publish: false,
      parser: "extractCashUpStructuredFacts",
      periodStart,
      periodEnd,
      warnings: ["Cash-up parsed from flattened text — review recommended."],
    };
  }

  const rows = matrix.slice(0, 250).map((line, index) => ({
    file_id: fileRow.id,
    file_version_id: versionRowId,
    branch_id: fileRow.primary_branch_id,
    brand_wide: fileRow.brand_wide,
    department: fileRow.department,
    report_type: fileRow.report_type,
    sensitivity_level: fileRow.sensitivity_level,
    metric_key: "raw_extract_line",
    metric_value: null,
    dimensions: { row_index: index, text: line.join(" | ").slice(0, 500) },
    period_start: periodStart,
    period_end: periodEnd,
    grain: "line",
    source_row_ref: `drive-row-${index + 1}`,
    confidence: 0.35,
    created_by: email,
  }));
  if (!rows.length) {
    return {
      factCount: 0,
      stage: "chunks_indexed",
      confidence: null,
      confidenceLevel: null,
      publish: false,
      parser: null,
      periodStart: null,
      periodEnd: null,
      warnings: [],
    };
  }
  if (!periodStart || !periodEnd) {
    throw new Error("Drive ingest could not resolve period_start/period_end for structured facts — existing facts preserved.");
  }
  await persistParsedFacts(admin, {
    fileRow,
    versionRowId,
    email,
    rows,
    periodStart,
    periodEnd,
  });
  return {
    factCount: rows.length,
    stage: "raw_extract_only",
    confidence: 0.35,
    confidenceLevel: "low",
    publish: false,
    parser: "raw_extract_line",
    periodStart,
    periodEnd,
    warnings: [],
  };
}

async function updateRun(admin: SupabaseLike, runId: string, patch: Record<string, any>, counters?: RunCounters) {
  const statsPatch = patch.stats || {};
  let mergedStats = statsPatch;
  if (Object.keys(statsPatch).length) {
    const { data: existing } = await admin
      .from("ask_nac_drive_sync_runs")
      .select("stats")
      .eq("id", runId)
      .maybeSingle();
    mergedStats = {
      ...((existing?.stats as Record<string, unknown>) || {}),
      ...statsPatch,
      runtimeStage: patch.runtime_stage || statsPatch.runtimeStage || (existing?.stats as Record<string, unknown>)?.runtimeStage,
    };
  }
  const next = {
    ...patch,
    ...(counters || {}),
    ...(Object.keys(statsPatch).length ? { stats: mergedStats } : {}),
    files_discovered: counters?.discovered_count,
    files_new: counters?.new_count,
    files_changed: counters?.changed_count,
    files_skipped: counters?.skipped_count,
    files_failed: counters?.failed_count,
    runtime_stage: patch.runtime_stage || statsPatch.runtimeStage,
    error_message: patch.error_message || patch.error,
    current_folder_path: patch.current_folder_path || statsPatch.currentDriveFolderPath,
    current_file_path: patch.current_file_path || patch.current_file,
    completed_at: patch.completed_at || patch.finished_at,
    updated_at: nowIso(),
  };
  delete next.folders_scanned;
  delete next.max_depth;
  Object.keys(next).forEach((key) => next[key] === undefined && delete next[key]);
  const { error } = await withTimeout(
    admin.from("ask_nac_drive_sync_runs").update(next).eq("id", runId),
    DB_OPERATION_TIMEOUT_MS,
    `Drive run update ${runId}`,
  );
  if (error) throw new DriveIngestionError("drive_run_update_failed", error.message);
}

async function createRunFile(
  admin: SupabaseLike,
  {
    runId,
    folderId,
    driveFile,
    action,
  }: { runId: string; folderId: string; driveFile: DriveFileWithPath; action: string },
) {
  const { data, error } = await admin
    .from("ask_nac_drive_sync_run_files")
    .insert({
      run_id: runId,
      folder_id: folderId,
      drive_file_id: driveFile.id,
      file_name: driveFile.name,
      mime_type: driveFile.mimeType,
      modified_time: driveFile.modifiedTime || null,
      source_version: driveFile.version || null,
      checksum: driveFile.md5Checksum || null,
      status: "queued",
      action,
      stats: {
        folderPath: driveFile.folderPath || null,
        relativePath: driveFile.relativePath || driveFile.name,
        depth: driveFile.depth ?? 0,
        reason: action === "skipped" ? "skipped" : null,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function markRunFile(admin: SupabaseLike, id: string, patch: Record<string, any>) {
  const statsPatch = patch.stats || patch.reason
    ? { ...(patch.stats || {}), ...(patch.reason ? { reason: patch.reason } : {}) }
    : undefined;
  const updatePayload = {
    ...patch,
    ...(statsPatch ? { stats: statsPatch } : {}),
    finished_at: patch.status && patch.status !== "running" ? nowIso() : patch.finished_at,
  };
  delete updatePayload.reason;
  const { error } = await withTimeout(
    admin
      .from("ask_nac_drive_sync_run_files")
      .update(updatePayload)
      .eq("id", id),
    DB_OPERATION_TIMEOUT_MS,
    `Drive run file update ${id}`,
  );
  if (error) throw new DriveIngestionError("drive_run_file_update_failed", error.message);
}

async function findExistingDriveFile(admin: SupabaseLike, driveFile: DriveFileWithPath, email: string) {
  const { data } = await admin
    .from("ask_nac_files")
    .select("id,content_hash,external_source_modified_at,source_external_version,source_external_checksum")
    .eq("external_source_id", driveFile.id)
    .eq("uploader_email", email)
    .eq("status", "active")
    .maybeSingle();
  return data || null;
}

function isUnchanged(existing: any, driveFile: DriveFile) {
  if (!existing) return false;
  if (driveFile.md5Checksum && existing.source_external_checksum === driveFile.md5Checksum) return true;
  if (driveFile.version && existing.source_external_version === String(driveFile.version)) return true;
  if (driveFile.modifiedTime && existing.external_source_modified_at) {
    return new Date(driveFile.modifiedTime).getTime() <= new Date(existing.external_source_modified_at).getTime();
  }
  return false;
}

async function registerDownloadedDriveFile(
  admin: SupabaseLike,
  {
    folder,
    driveFile,
    download,
    contentHash,
    existing,
    email,
    discoveryDecision,
  }: {
    folder: DriveFolder;
    driveFile: DriveFileWithPath;
    download: { buffer: ArrayBuffer; filename: string; mimeType: string; extension: string; size: number };
    contentHash: string;
    existing: any;
    email: string;
    discoveryDecision?: { vaultReportType?: string | null } | null;
  },
) {
  const meta = normalizeFolderMetadata(folder);
  if (!meta.branchId) {
    throw new Error("Drive folder is missing branch mapping; set branch_id before ingestion.");
  }
  const reportType = resolveDriveFileReportType(folder, driveFile, meta.reportType, discoveryDecision);

  const fileId = existing?.id || crypto.randomUUID();
  const storagePath = `drive/${meta.branchId}/${meta.department}/${fileId}/${safeName(download.filename)}`;
  const { error: storageError } = await admin.storage
    .from(VAULT_STORAGE_BUCKET)
    .upload(storagePath, new Blob([download.buffer], { type: download.mimeType }), {
      upsert: Boolean(existing?.id),
      contentType: download.mimeType,
    });
  if (storageError) throw new Error(storageError.message);

  const fileRow = {
    id: fileId,
    title: driveFile.name,
    original_filename: download.filename,
    storage_bucket: VAULT_STORAGE_BUCKET,
    storage_path: storagePath,
    branch_scope_type: "single_branch",
    primary_branch_id: meta.branchId,
    brand_wide: false,
    department: meta.department,
    report_type: reportType,
    data_layer: "operational",
    sensitivity_level: meta.sensitivity,
    status: "active",
    uploaded_by: email.split("@")[0],
    uploader_email: email,
    content_hash: contentHash,
    ingestion_source: "drive_sync",
    external_source_id: driveFile.id,
    external_source_modified_at: driveFile.modifiedTime || null,
    source_external_version: driveFile.version || null,
    source_external_checksum: driveFile.md5Checksum || null,
    notes: `Imported from Google Drive path ${driveFile.relativePath || driveFile.name}.`,
    search_status: "indexing",
    searchable: false,
    updated_at: nowIso(),
  };

  if (existing?.id) {
    const { error } = await admin.from("ask_nac_files").update(fileRow).eq("id", fileId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("ask_nac_files").insert(fileRow);
    if (error) throw new Error(error.message);
    await admin.from("ask_nac_data_coverage").insert({
      branch_id: meta.branchId,
      brand_wide: false,
      department: meta.department,
      report_type: reportType,
      source_file_id: fileId,
      fact_count: 0,
      readiness_status: "registered",
    });
  }

  const versionRow = await createFileVersion(admin, {
    fileId,
    storagePath,
    contentHash,
    sizeBytes: download.size,
    mimeType: download.mimeType,
  });

  const jobId = crypto.randomUUID();
  const compilerProfile = buildCompilerProfile({ reportType });
  await admin.from("ask_nac_ingestion_jobs").insert({
    id: jobId,
    file_id: fileId,
    file_version_id: versionRow.id,
    status: "processing",
    stage: "extract",
    started_at: nowIso(),
    compiler_profile: compilerProfile,
    stats: {
      source: "google_drive",
      driveFileId: driveFile.id,
      folderPath: driveFile.folderPath,
      relativePath: driveFile.relativePath,
    },
  });
  await initializeCompilerJobObservability(admin, jobId, { compilerProfile });
  await startCompilerStage(admin, jobId, "legacy_drive_ingest", {
    driveFileId: driveFile.id,
    relativePath: driveFile.relativePath,
  });

  return { fileId, fileRow, versionRowId: versionRow.id, jobId };
}

async function completeJob(
  admin: SupabaseLike,
  {
    jobId,
    fileId,
    chunkCount,
    parseResult,
    warnings,
  }: {
    jobId: string;
    fileId: string;
    chunkCount: number;
    parseResult: StructuredFactsResult;
    warnings: string[];
  },
) {
  const factCount = parseResult.factCount;
  const readiness = factCount > 0 ? (parseResult.publish ? "ready" : "partial") : "registered";
  const mergedWarnings = [...(parseResult.warnings || []), ...(warnings || [])];

  // Observability must never block marking the job completed after facts/chunks are stored.
  try {
    await completeCompilerStage(admin, jobId, "legacy_parse", {
      factCount,
      parser: parseResult.parser,
      publish: parseResult.publish,
    });
    await completeCompilerStage(admin, jobId, "publish", {
      factCount,
      readiness,
      chunkCount,
    });
    await setCompilerManifest(admin, jobId, {
      factCount,
      chunkCount,
      parser: parseResult.parser,
      publish: parseResult.publish,
      source: "google_drive",
    });
    await completeCompilerStage(admin, jobId, "legacy_drive_ingest", { factCount, chunkCount });
  } catch (_err) {
    // non-blocking
  }

  const { error: jobError } = await admin.from("ask_nac_ingestion_jobs").update({
    status: "completed",
    stage: parseResult.stage || (factCount > 0 ? "raw_extract_only" : "chunks_indexed"),
    finished_at: nowIso(),
    error: mergedWarnings.length ? mergedWarnings.join(" ") : null,
    stats: {
      source: "google_drive",
      chunkCount,
      searchStatus: chunkCount > 0 ? "searchable" : "not_searchable",
      factsExtracted: factCount,
      factsPersisted: factCount,
      confidence: parseResult.confidence,
      confidenceLevel: parseResult.confidenceLevel,
      publish: parseResult.publish,
      parser: parseResult.parser,
      periodStart: parseResult.periodStart,
      periodEnd: parseResult.periodEnd,
      warnings: mergedWarnings,
    },
  }).eq("id", jobId);
  if (jobError) throw new Error(jobError.message);

  await admin.from("ask_nac_data_coverage").update({
    fact_count: factCount,
    readiness_status: readiness,
    last_ingested_at: nowIso(),
    updated_at: nowIso(),
    ...(parseResult.periodStart && parseResult.periodEnd
      ? { period_start: parseResult.periodStart, period_end: parseResult.periodEnd }
      : {}),
  }).eq("source_file_id", fileId);
}

async function failJob(admin: SupabaseLike, jobId: string | null, error: string) {
  if (!jobId) return;
  await failCompilerStage(admin, jobId, "legacy_drive_ingest", error);
  await admin.from("ask_nac_ingestion_jobs").update({
    status: "failed",
    stage: "drive_ingest",
    error,
    finished_at: nowIso(),
    stats: { source: "google_drive", error },
  }).eq("id", jobId);
}

async function processOneDriveFile(
  admin: SupabaseLike,
  {
    accessToken,
    folder,
    runId,
    driveFile,
    email,
    counters,
    force = false,
    discoveryRules = null as Record<string, unknown>[] | null,
  }: {
    accessToken: string;
    folder: DriveFolder;
    runId: string;
    driveFile: DriveFileWithPath;
    email: string;
    counters: RunCounters;
    force?: boolean;
    discoveryRules?: Record<string, unknown>[] | null;
  },
) {
  const meta = normalizeFolderMetadata(folder);
  const rules = discoveryRules || [];
  const discoveryDecision = folder.is_discovery_root
    ? classifyDrivePath(driveFile.folderPath || driveFile.relativePath || "", driveFile.name || "", rules, meta.branchId)
    : null;

  if (discoveryDecision && !shouldIngestDiscoveryDecision(discoveryDecision)) {
    counters.skipped_count += 1;
    const itemId = await createRunFile(admin, { runId, folderId: folder.id, driveFile, action: "skipped" });
    await markRunFile(admin, itemId, {
      status: "skipped",
      reason: discoveryDecision.action === "ignore" ? "discovery_ignored" : "discovery_needs_approval",
      error:
        discoveryDecision.action === "ignore"
          ? `Discovery rule: ignore (${discoveryDecision.reason}).`
          : `Discovery gate: ${discoveryDecision.detectedReportType} needs approval (${discoveryDecision.reason}).`,
      stats: {
        folderPath: driveFile.folderPath,
        relativePath: driveFile.relativePath,
        depth: driveFile.depth,
        discovery: discoveryDecision,
      },
    });
    await updateRun(admin, runId, {}, counters);
    return;
  }

  const existing = await findExistingDriveFile(admin, driveFile, email);
  const action = existing ? "changed" : "new";
  if (!force && isUnchanged(existing, driveFile)) {
    counters.skipped_count += 1;
    const itemId = await createRunFile(admin, { runId, folderId: folder.id, driveFile, action: "skipped" });
    await markRunFile(admin, itemId, {
      status: "skipped",
      error: "Unchanged Drive file.",
      stats: { folderPath: driveFile.folderPath, relativePath: driveFile.relativePath, depth: driveFile.depth },
    });
    await updateRun(admin, runId, {}, counters);
    return;
  }

  if (existing) counters.changed_count += 1;
  else counters.new_count += 1;

  const itemId = await createRunFile(admin, { runId, folderId: folder.id, driveFile, action });
  let jobId: string | null = null;
  try {
    await markRunFile(admin, itemId, { status: "running" });
    await updateRun(admin, runId, {
      runtime_stage: "downloading_started",
      current_file: driveFile.relativePath || driveFile.name,
      current_file_path: driveFile.relativePath || driveFile.name,
    }, counters);

    const download = await downloadDriveFile(accessToken, driveFile);
    counters.downloaded_count += 1;
    const contentHash = await sha256Hex(download.buffer);
    if (!force && existing?.content_hash && existing.content_hash === contentHash) {
      counters.skipped_count += 1;
      await markRunFile(admin, itemId, {
        status: "skipped",
        error: "Identical content already indexed.",
        stats: { folderPath: driveFile.folderPath, relativePath: driveFile.relativePath, depth: driveFile.depth },
      });
      return;
    }

    await updateRun(admin, runId, {
      runtime_stage: "file_registry_started",
      current_file: driveFile.relativePath || driveFile.name,
      current_file_path: driveFile.relativePath || driveFile.name,
    }, counters);
    const registered = await registerDownloadedDriveFile(admin, {
      folder,
      driveFile,
      download,
      contentHash,
      existing,
      email,
      discoveryDecision,
    });
    jobId = registered.jobId;

    await completeCompilerStage(admin, jobId, "classify", {
      reportType: registered.fileRow.report_type,
      source: "google_drive",
      discoveryType: discoveryDecision?.detectedReportType || null,
    });

    await updateRun(admin, runId, {
      runtime_stage: "extracting_started",
      current_file: driveFile.relativePath || driveFile.name,
      current_file_path: driveFile.relativePath || driveFile.name,
    }, counters);
    const extracted = await extractText(download);
    counters.extracted_count += 1;
    await startCompilerStage(admin, jobId, "extract", { textLength: extracted.text?.length || 0 });
    await completeCompilerStage(admin, jobId, "extract", { textLength: extracted.text?.length || 0 });
    const chunks = buildChunks(extracted);
    await updateRun(admin, runId, {
      runtime_stage: "indexing_started",
      current_file: driveFile.relativePath || driveFile.name,
      current_file_path: driveFile.relativePath || driveFile.name,
      stats: { chunkPlanCount: chunks.length, extractedChars: extracted.text?.length || 0 },
    }, counters);
    const chunkCount = await persistChunks(admin, {
      fileId: registered.fileId,
      versionRowId: registered.versionRowId,
      fileRow: registered.fileRow,
      chunks,
    });
    if (chunkCount > 0) counters.indexed_count += 1;
    await completeCompilerStage(admin, jobId, "legacy_chunk", { chunkCount });
    // Flush indexed progress immediately so UI is not stuck on indexing_started during parse.
    await updateRun(admin, runId, {
      runtime_stage: "parsing_started",
      current_file: driveFile.relativePath || driveFile.name,
      current_file_path: driveFile.relativePath || driveFile.name,
      stats: { chunkCount },
    }, counters);

    await startCompilerStage(admin, jobId, "legacy_parse", { reportType: registered.fileRow.report_type });
    const parseResult = await insertStructuredFacts(admin, {
      fileRow: registered.fileRow,
      versionRowId: registered.versionRowId,
      text: extracted.text,
      email,
      download,
      onFactsBatch: async ({ batchIndex, batchCount, insertedSoFar }) => {
        await updateRun(admin, runId, {
          runtime_stage: "facts_persisting",
          current_file: driveFile.relativePath || driveFile.name,
          current_file_path: driveFile.relativePath || driveFile.name,
          stats: {
            factsBatchIndex: batchIndex,
            factsBatchCount: batchCount,
            factsInsertedSoFar: insertedSoFar,
          },
        }, counters);
      },
    });
    if (parseResult.factCount > 0) counters.parsed_count += 1;
    await updateRun(admin, runId, {
      runtime_stage: "completing",
      current_file: driveFile.relativePath || driveFile.name,
      current_file_path: driveFile.relativePath || driveFile.name,
      stats: { factCount: parseResult.factCount, chunkCount },
    }, counters);

    await completeJob(admin, {
      jobId,
      fileId: registered.fileId,
      chunkCount,
      parseResult,
      warnings: extracted.warnings || [],
    });
    await ensureIngestionEntities(admin, {
      fileRecord: registered.fileRow,
      jobId,
      fileVersionId: registered.versionRowId,
      extractionMethod: "google_drive_ingest",
      createdBy: email,
    }).catch(() => null);
    await markRunFile(admin, itemId, {
      status: "completed",
      file_id: registered.fileId,
      stats: {
        chunkCount,
        factCount: parseResult.factCount,
        parser: parseResult.parser,
        size: download.size,
        folderPath: driveFile.folderPath,
        relativePath: driveFile.relativePath,
        depth: driveFile.depth,
      },
    });
  } catch (err) {
    const message = sanitizeErrorMessage(err);
    const code = errorCode(err);
    counters.failed_count += 1;
    await failJob(admin, jobId, message);
    await markRunFile(admin, itemId, { status: "failed", reason: code, error: message });
  } finally {
    await updateRun(admin, runId, {}, counters);
  }
}

export async function createDriveIngestionRun(
  admin: SupabaseLike,
  {
    folder,
    triggerType = "manual",
    initialStats = {},
  }: { folder: DriveFolder; triggerType?: string; initialStats?: Record<string, unknown> },
) {
  // Concurrency guard: one active run per folder (manual or scheduled).
  const { data: activeRun } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("id,status")
    .eq("folder_id", folder.id)
    .in("status", ["running", "queued"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRun?.id) {
    throw new Error(
      `Drive ingestion already ${activeRun.status} for this folder (run ${activeRun.id}). Skip to avoid double-ingest.`,
    );
  }

  const { data, error } = await admin
    .from("ask_nac_drive_sync_runs")
    .insert({
      folder_id: folder.id,
      trigger_type: triggerType === "scheduled" ? "scheduled" : "manual",
      status: "queued",
      runtime_stage: String(initialStats.runtimeStage || "queued"),
      selected_folders_count: Number(initialStats.selectedFoldersCount || initialStats.selectedFolderCount || 1),
      selected_drive_folder_ids: Array.isArray(initialStats.selectedDriveFolderIds)
        ? initialStats.selectedDriveFolderIds
        : [folder.drive_folder_id],
      updated_at: nowIso(),
      stats: {
        autoIngest: Boolean(folder.auto_ingest),
        folderRowId: folder.id,
        driveFolderId: folder.drive_folder_id,
        ...initialStats,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function resolveDriveIngestOffset(
  admin: SupabaseLike,
  folderId: string,
  runStats: Record<string, unknown>,
) {
  if (Number.isFinite(Number(runStats.startOffset))) {
    return Math.max(0, Number(runStats.startOffset));
  }
  const { data: prevRun } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("stats,status")
    .eq("folder_id", folderId)
    .in("status", ["partial", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOffset = Number((prevRun?.stats as Record<string, unknown> | undefined)?.nextFileOffset);
  if (Number.isFinite(nextOffset) && nextOffset > 0) {
    const remaining = Number((prevRun?.stats as Record<string, unknown> | undefined)?.remainingFiles);
    if (prevRun?.status === "partial" || remaining > 0) return nextOffset;
  }
  return 0;
}

export async function processDriveIngestionRun(
  admin: SupabaseLike,
  {
    accessToken,
    folder,
    runId,
    email,
    onlyDriveFileId = null,
    force = false,
    maxFilesToProcess = DEFAULT_MAX_FILES_TO_PROCESS,
  }: {
    accessToken: string;
    folder: DriveFolder;
    runId: string;
    email: string;
    onlyDriveFileId?: string | null;
    force?: boolean;
    maxFilesToProcess?: number;
  },
) {
  const counters: RunCounters = {
    discovered_count: 0,
    new_count: 0,
    changed_count: 0,
    skipped_count: 0,
    downloaded_count: 0,
    extracted_count: 0,
    parsed_count: 0,
    indexed_count: 0,
    failed_count: 0,
  };
  const runStats: Record<string, unknown> = {
    runtimeStage: "starting",
    folderRowId: folder.id,
    driveFolderId: folder.drive_folder_id,
    autoIngest: Boolean(folder.auto_ingest),
    isDiscoveryRoot: Boolean(folder.is_discovery_root),
  };
  let discoveryRules: Record<string, unknown>[] = [];
  if (folder.is_discovery_root) {
    const meta = normalizeFolderMetadata(folder);
    discoveryRules = await fetchActiveDiscoveryRules(admin, meta.branchId || null);
    runStats.discoveryRulesLoaded = discoveryRules.length;
  }

  try {
    await updateRun(admin, runId, {
      status: "running",
      runtime_stage: "worker_started",
      started_at: nowIso(),
      current_file: null,
      stats: runStats,
    }, counters);

    let files: DriveFileWithPath[] = [];
    let traversal = {
      foldersScanned: 0,
      maxDepth: 0,
      duplicateCount: 0,
      truncated: false,
    };
    if (onlyDriveFileId) {
      runStats.runtimeStage = "loading_drive_file";
      await updateRun(admin, runId, { stats: runStats }, counters);
      const driveFile = await getDriveFile(accessToken, onlyDriveFileId);
      const rootPath = folderRootLabel(folder);
      files = [{
        ...driveFile,
        folderPath: rootPath,
        relativePath: joinDrivePath([rootPath, driveFile.name]),
        depth: 0,
      }];
      traversal = { foldersScanned: 1, maxDepth: 0, duplicateCount: 0, truncated: false };
    } else {
      runStats.runtimeStage = "verifying_root_folder";
      await updateRun(admin, runId, {
        current_folder_path: folderRootLabel(folder),
        stats: runStats,
      }, counters);
      const rootFolder = await verifyDriveFolderAccess(accessToken, folder.drive_folder_id);
      runStats.rootFolderAccessVerified = true;
      runStats.rootFolderName = rootFolder.name;
      runStats.rootFolderMimeType = rootFolder.mimeType;
      runStats.rootFolderDriveId = rootFolder.driveId || null;
      runStats.rootFolderTrashed = Boolean(rootFolder.trashed);
      runStats.runtimeStage = "traversal_started";
      await updateRun(admin, runId, {
        current_folder_path: rootFolder.name || folderRootLabel(folder),
        stats: runStats,
      }, counters);
      traversal = await walkDriveFolderTree(accessToken, {
        rootFolderId: folder.drive_folder_id,
        rootLabel: rootFolder.name || folderRootLabel(folder),
        onFolderScanned: async (info) => {
          runStats.runtimeStage = info.foldersScanned === 1 ? "first_drive_list_call" : "listing_drive_folder";
          runStats.folders_scanned = info.foldersScanned;
          runStats.max_depth = info.maxDepth;
          runStats.currentDriveFolderId = info.folderId;
          runStats.currentDriveFolderPath = info.folderPath;
          runStats.currentDriveFolderDepth = info.depth;
          await updateRun(admin, runId, {
            current_file: `Scanning ${info.folderPath}`,
            current_folder_path: info.folderPath,
            stats: runStats,
          }, counters);
        },
        onFirstListResponse: async (info) => {
          runStats.runtimeStage = "first_drive_list_response";
          runStats.firstDriveListResponse = info;
          await updateRun(admin, runId, { stats: runStats }, counters);
        },
      });
      files = traversal.files;
    }

    counters.discovered_count = files.length;
    runStats.folders_scanned = traversal.foldersScanned;
    runStats.max_depth = traversal.maxDepth;
    runStats.runtimeStage = "traversal_completed";
    runStats.discoveredFiles = files.length;
    await updateRun(admin, runId, { current_file: null, stats: runStats }, counters);

    if (!files.length) {
      runStats.runtimeStage = "completed_empty";
      runStats.emptyReason = "Drive folder scanned successfully but no child files/folders were returned.";
      runStats.emptyLikelyCauses = [
        "wrong folder ID",
        "folder inaccessible to connected account",
        "folder contains shortcuts only",
        "Drive API query mismatch",
      ];
      await updateRun(admin, runId, {
        status: "completed_empty",
        current_file: null,
        error: "Drive folder scanned successfully but no child files/folders were returned.",
        finished_at: nowIso(),
        stats: runStats,
      }, counters);
      await admin.from("ask_nac_drive_sync_folders").update({
        last_sync_at: nowIso(),
        last_sync_status: "completed_empty",
      }).eq("id", folder.id);
      return;
    }

    if (!folder.auto_ingest) {
      for (const driveFile of files) {
        const existing = await findExistingDriveFile(admin, driveFile, email);
        if (isUnchanged(existing, driveFile)) counters.skipped_count += 1;
        else if (existing) counters.changed_count += 1;
        else counters.new_count += 1;
        const itemId = await createRunFile(admin, {
          runId,
          folderId: folder.id,
          driveFile,
          action: "metadata_only",
        });
        await markRunFile(admin, itemId, {
          status: "skipped",
          error: "Folder auto_ingest=false; metadata listed only.",
          stats: { folderPath: driveFile.folderPath, relativePath: driveFile.relativePath, depth: driveFile.depth },
        });
      }
      await updateRun(admin, runId, {
        status: "completed",
        current_file: null,
        finished_at: nowIso(),
        stats: {
          ...runStats,
          metadataOnly: true,
          autoIngest: false,
          duplicateFileIdsSkipped: traversal.duplicateCount,
          truncated: traversal.truncated,
        },
      }, counters);
      await admin.from("ask_nac_drive_sync_folders").update({
        last_sync_at: nowIso(),
        last_sync_status: "completed",
      }).eq("id", folder.id);
      return;
    }

    const startOffset = await resolveDriveIngestOffset(admin, folder.id, runStats);
    const filesToProcess = files.slice(startOffset, startOffset + Math.max(1, maxFilesToProcess));
    const nextFileOffset = startOffset + filesToProcess.length;
    const leftForLater = Math.max(0, files.length - nextFileOffset);
    runStats.startOffset = startOffset;
    runStats.nextFileOffset = nextFileOffset;

    for (const driveFile of filesToProcess) {
      const exportInfo = resolveDriveExport(driveFile);
      if ("unsupported" in exportInfo) {
        counters.skipped_count += 1;
        const itemId = await createRunFile(admin, { runId, folderId: folder.id, driveFile, action: "skipped" });
        await markRunFile(admin, itemId, {
          status: "skipped",
          reason: "unsupported_mime_type",
          error: exportInfo.unsupported,
          stats: { folderPath: driveFile.folderPath, relativePath: driveFile.relativePath, depth: driveFile.depth },
        });
        await updateRun(admin, runId, {}, counters);
        continue;
      }
      await processOneDriveFile(admin, {
        accessToken,
        folder,
        runId,
        driveFile,
        email,
        counters,
        force,
        discoveryRules,
      });
    }

    const finalStatus =
      traversal.truncated || leftForLater > 0
        ? "partial"
        : counters.failed_count > 0 && (counters.indexed_count > 0 || counters.skipped_count > 0)
        ? "partial"
        : counters.failed_count > 0
          ? "failed"
          : "completed";
    if (finalStatus === "completed" && leftForLater === 0) {
      runStats.nextFileOffset = 0;
    }
    runStats.remainingFiles = leftForLater;
    runStats.runtimeStage = finalStatus;
    await updateRun(admin, runId, {
      status: finalStatus,
      current_file: null,
      finished_at: nowIso(),
      stats: {
        ...runStats,
        autoIngest: true,
        duplicateFileIdsSkipped: traversal.duplicateCount,
        truncated: traversal.truncated,
        processedFiles: filesToProcess.length,
        remainingFiles: leftForLater,
        truncationReason: traversal.truncated
          ? `Drive traversal hit max item limit (${MAX_DRIVE_ITEMS_PER_RUN}).`
          : leftForLater > 0
            ? `Processed ${filesToProcess.length} file(s); ${leftForLater} remain. Run Sync & Ingest Drive again to continue.`
            : null,
      },
      error: finalStatus === "failed" ? "All Drive files failed ingestion." : null,
    }, counters);
    const folderUpdate: Record<string, string> = {
      last_sync_at: nowIso(),
      last_sync_status: finalStatus,
    };
    if (counters.downloaded_count > 0) folderUpdate.last_ingest_at = nowIso();
    await admin.from("ask_nac_drive_sync_folders").update(folderUpdate).eq("id", folder.id);
  } catch (err) {
    const message = sanitizeErrorMessage(err);
    const code = errorCode(err);
    runStats.runtimeStage = "failed";
    runStats.exception = message;
    runStats.errorCode = code;
    await updateRun(admin, runId, {
      status: "failed",
      error_code: code,
      current_file: null,
      error: message,
      finished_at: nowIso(),
      stats: runStats,
    }, counters);
    await admin.from("ask_nac_drive_sync_folders").update({
      last_sync_at: nowIso(),
      last_sync_status: "failed",
    }).eq("id", folder.id);
  }
}

export async function fetchDriveRunStatus(admin: SupabaseLike, runId: string, email: string) {
  const { data: run, error } = await admin
    .from("ask_nac_drive_sync_runs")
    .select("*, folder:ask_nac_drive_sync_folders(id,connection_id,drive_folder_id,label,folder_name)")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!run?.folder?.connection_id) return null;

  const { data: connection } = await admin
    .from("ask_nac_drive_connections")
    .select("id,user_email")
    .eq("id", run.folder.connection_id)
    .eq("user_email", email)
    .maybeSingle();
  if (!connection) return null;

  const { data: files } = await admin
    .from("ask_nac_drive_sync_run_files")
    .select("id,drive_file_id,file_name,status,action,error,file_id,stats,created_at,finished_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  const normalizedRun = {
    ...run,
    folders_scanned: Number(run.stats?.folders_scanned ?? run.stats?.foldersScanned ?? 0) || 0,
    max_depth: Number(run.stats?.max_depth ?? run.stats?.maxDepth ?? 0) || 0,
  };

  return { run: normalizedRun, files: files || [] };
}

