/**
 * Collect files from file inputs and drag-and-drop (including nested folders).
 */

import { isLegacyDocFile, isSupportedVaultUploadFile } from "./vaultConstants";

/** @typedef {{ file: File, relativePath: string }} VaultUploadFileEntry */

/**
 * Attach webkitRelativePath when the browser did not set it (e.g. drag-and-drop).
 * @param {File} file
 * @param {string} [relativePath]
 * @returns {File}
 */
export function fileWithRelativePath(file, relativePath) {
  const path = String(relativePath || file.webkitRelativePath || file.name || "").trim();
  if (!path || file.webkitRelativePath === path) return file;
  try {
    Object.defineProperty(file, "webkitRelativePath", {
      value: path,
      writable: false,
      configurable: true,
    });
  } catch {
    // read-only in some environments — caller still has relativePath in batch metadata
  }
  return file;
}

/**
 * @param {FileList|File[]|null|undefined} fileList
 * @returns {File[]}
 */
export function filesFromInput(fileList) {
  if (!fileList?.length) return [];
  return Array.from(fileList);
}

/**
 * Split a file-picker selection: one supported file → single upload; otherwise bulk.
 * @param {FileList|File[]|null|undefined} fileList
 * @returns {{ mode: "none"|"single"|"bulk", files: File[], legacyRejected: File[], unsupportedRejected: File[] }}
 */
export function resolveUploadFileSelection(fileList) {
  const files = filesFromInput(fileList);
  if (!files.length) {
    return { mode: "none", files: [], legacyRejected: [], unsupportedRejected: [] };
  }

  const legacyRejected = files.filter((f) => isLegacyDocFile(f));
  const unsupportedRejected = files.filter(
    (f) => !isLegacyDocFile(f) && !isSupportedVaultUploadFile(f),
  );
  const supported = files.filter((f) => isSupportedVaultUploadFile(f));

  if (supported.length === 1 && files.length === 1) {
    return { mode: "single", files: supported, legacyRejected, unsupportedRejected };
  }

  if (supported.length > 0) {
    return { mode: "bulk", files: supported, legacyRejected, unsupportedRejected };
  }

  return { mode: "none", files: [], legacyRejected, unsupportedRejected };
}

/**
 * Read all files under a FileSystem entry (file or directory).
 * @param {FileSystemEntry} entry
 * @param {string} [basePath]
 * @returns {Promise<VaultUploadFileEntry[]>}
 */
export async function readFileSystemEntry(entry, basePath = "") {
  if (!entry) return [];

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
    const relativePath = basePath ? `${basePath}/${file.name}` : file.name;
    return [{ file: fileWithRelativePath(file, relativePath), relativePath }];
  }

  if (entry.isDirectory) {
    const directoryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    const collected = [];

    const readBatch = () =>
      new Promise((resolve, reject) => {
        reader.readEntries(
          async (entries) => {
            if (!entries.length) {
              resolve();
              return;
            }
            try {
              for (const child of entries) {
                const nested = await readFileSystemEntry(child, directoryPath);
                collected.push(...nested);
              }
              await readBatch();
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          reject,
        );
      });

    await readBatch();
    return collected;
  }

  return [];
}

/**
 * Collect supported files from DataTransfer (loose files + nested folders).
 * @param {DataTransfer|null|undefined} dataTransfer
 * @returns {Promise<File[]>}
 */
export async function collectFilesFromDataTransfer(dataTransfer) {
  const items = dataTransfer?.items;
  if (items?.length && typeof items[0].webkitGetAsEntry === "function") {
    const entries = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(...(await readFileSystemEntry(entry)));
    }
    if (entries.length) {
      return entries.map((e) => e.file);
    }
  }

  const fallback = filesFromInput(dataTransfer?.files);
  return fallback.map((file) => fileWithRelativePath(file, file.webkitRelativePath || file.name));
}

/**
 * Filter to supported vault upload files (excludes legacy .doc).
 * @param {File[]|FileList} fileList
 * @returns {File[]}
 */
export function filterSupportedVaultUploadFiles(fileList) {
  return filesFromInput(fileList).filter((f) => isSupportedVaultUploadFile(f));
}
