/**
 * Upload queue helpers for Company Knowledge bulk imports.
 */

import { partitionVaultUploadFiles } from "./vaultBulkIngestion";

/** @typedef {"pending"|"processing"|"completed"|"failed"|"skipped"} UploadQueueStatus */

/**
 * @param {File[]|FileList} fileList
 * @returns {Array<{ id: string, name: string, relativePath: string, status: UploadQueueStatus }>}
 */
export function buildUploadQueueFromFiles(fileList) {
  const { legacyDocFiles, entries } = partitionVaultUploadFiles(fileList);
  const queue = entries.map((entry, index) => ({
    id: `upload-${index}-${entry.relativePath}`,
    name: entry.file.name,
    relativePath: entry.relativePath,
    status: /** @type {UploadQueueStatus} */ ("pending"),
  }));

  legacyDocFiles.forEach((file, index) => {
    queue.push({
      id: `legacy-${index}-${file.name}`,
      name: file.name,
      relativePath: file.name,
      status: "skipped",
    });
  });

  return queue;
}

/**
 * @param {Array<{ id: string, name: string, relativePath: string, status: UploadQueueStatus, error?: string }>} queue
 * @param {Array<{ relativePath: string, file: File }>} entries
 * @param {Array<{ ok?: boolean, status?: string, error?: string }>} [results]
 */
export function applyBulkResultsToUploadQueue(queue, entries, results = []) {
  return queue.map((item) => {
    if (item.status === "skipped") return item;
    const idx = entries.findIndex((e) => e.relativePath === item.relativePath);
    if (idx < 0) return item;
    const result = results[idx];
    if (!result) return item;
    if (result.status === "skipped") return { ...item, status: "skipped" };
    if (result.ok) return { ...item, status: "completed" };
    return { ...item, status: "failed", error: result.error || "Import failed" };
  });
}

/**
 * @param {Array<{ status: UploadQueueStatus }>} queue
 */
export function summarizeUploadQueue(queue) {
  return {
    pending: queue.filter((q) => q.status === "pending").length,
    processing: queue.filter((q) => q.status === "processing").length,
    completed: queue.filter((q) => q.status === "completed").length,
    failed: queue.filter((q) => q.status === "failed").length,
    skipped: queue.filter((q) => q.status === "skipped").length,
  };
}

/**
 * Mark the active file during bulk import progress.
 * @param {Array<{ id: string, name: string, relativePath: string, status: UploadQueueStatus }>} queue
 * @param {{ currentFile?: string|null }} progress
 */
export function markUploadQueueProcessing(queue, progress) {
  const current = progress?.currentFile;
  if (!current) return queue;
  return queue.map((item) => {
    if (item.status === "skipped" || item.status === "completed" || item.status === "failed") {
      return item;
    }
    if (item.relativePath === current || item.name === current) {
      return { ...item, status: "processing" };
    }
    if (item.status === "processing") {
      return { ...item, status: "pending" };
    }
    return item;
  });
}
