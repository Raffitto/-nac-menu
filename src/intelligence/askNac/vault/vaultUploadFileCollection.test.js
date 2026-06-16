import { readFileSync } from "fs";
import path from "path";
import {
  collectFilesFromDataTransfer,
  fileWithRelativePath,
  filesFromInput,
  readFileSystemEntry,
  resolveUploadFileSelection,
  filterSupportedVaultUploadFiles,
} from "./vaultUploadFileCollection";
import {
  applyBulkResultsToUploadQueue,
  buildUploadQueueFromFiles,
  markUploadQueueProcessing,
  summarizeUploadQueue,
} from "./vaultUploadQueue";

const PANEL_PATH = path.resolve(
  __dirname,
  "../../../dashboard/intelligence/AskNacDataVaultPanel.jsx",
);

function makeFile(name, { type = "application/pdf", relativePath = "" } = {}) {
  const file = new File(["content"], name, { type });
  if (relativePath) {
    Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
  }
  return file;
}

function makeMockFileEntry(name, { relativePath = name } = {}) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file(resolve) {
      resolve(makeFile(name, { relativePath }));
    },
  };
}

function makeMockDirectoryEntry(name, children = []) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      let sent = false;
      return {
        readEntries(resolve) {
          if (sent) {
            resolve([]);
            return;
          }
          sent = true;
          resolve(children);
        },
      };
    },
  };
}

describe("vaultUploadFileCollection", () => {
  test("resolveUploadFileSelection uses single mode for one supported file", () => {
    const file = makeFile("logbook.pdf");
    const result = resolveUploadFileSelection([file]);
    expect(result.mode).toBe("single");
    expect(result.files).toHaveLength(1);
  });

  test("resolveUploadFileSelection uses bulk mode for multiple supported files", () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    const result = resolveUploadFileSelection(files);
    expect(result.mode).toBe("bulk");
    expect(result.files).toHaveLength(2);
  });

  test("resolveUploadFileSelection rejects legacy .doc only selection", () => {
    const file = makeFile("legacy.doc");
    const result = resolveUploadFileSelection([file]);
    expect(result.mode).toBe("none");
    expect(result.legacyRejected).toHaveLength(1);
  });

  test("filesFromInput converts FileList-like input", () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    expect(filesFromInput(files)).toHaveLength(2);
    expect(filesFromInput({ length: 0 })).toHaveLength(0);
  });

  test("fileWithRelativePath sets webkitRelativePath", () => {
    const file = makeFile("nested.pdf");
    const withPath = fileWithRelativePath(file, "ops/may/nested.pdf");
    expect(withPath.webkitRelativePath).toBe("ops/may/nested.pdf");
  });

  test("readFileSystemEntry reads nested directory entries", async () => {
    const root = makeMockDirectoryEntry("folder", [
      makeMockDirectoryEntry("nested", [makeMockFileEntry("report.pdf", { relativePath: "folder/nested/report.pdf" })]),
      makeMockFileEntry("top.csv", { relativePath: "folder/top.csv" }),
    ]);

    const entries = await readFileSystemEntry(root);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.relativePath).sort()).toEqual(["folder/nested/report.pdf", "folder/top.csv"]);
    expect(entries[0].file.webkitRelativePath).toBeTruthy();
  });

  test("collectFilesFromDataTransfer reads loose files and folders", async () => {
    const fileEntry = makeMockFileEntry("loose.pdf");
    const folderEntry = makeMockDirectoryEntry("batch", [
      makeMockFileEntry("inner.docx", { relativePath: "batch/inner.docx" }),
    ]);

    const items = [
      {
        kind: "file",
        webkitGetAsEntry: () => fileEntry,
      },
      {
        kind: "file",
        webkitGetAsEntry: () => folderEntry,
      },
    ];

    const files = await collectFilesFromDataTransfer({ items });
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.webkitRelativePath || f.name).sort()).toEqual([
      "batch/inner.docx",
      "loose.pdf",
    ]);
  });

  test("filterSupportedVaultUploadFiles keeps supported extensions", () => {
    const files = [makeFile("a.pdf"), makeFile("notes.tmp")];
    expect(filterSupportedVaultUploadFiles(files)).toHaveLength(1);
  });
});

describe("vaultUploadQueue", () => {
  test("buildUploadQueueFromFiles tracks pending supported files", () => {
    const files = [
      makeFile("a.pdf", { relativePath: "ops/a.pdf" }),
      makeFile("b.pdf", { relativePath: "ops/b.pdf" }),
    ];
    const queue = buildUploadQueueFromFiles(files);
    expect(queue).toHaveLength(2);
    expect(queue.every((item) => item.status === "pending")).toBe(true);
    expect(summarizeUploadQueue(queue).pending).toBe(2);
  });

  test("markUploadQueueProcessing highlights current file", () => {
    const queue = [
      { id: "1", name: "a.pdf", relativePath: "ops/a.pdf", status: "pending" },
      { id: "2", name: "b.pdf", relativePath: "ops/b.pdf", status: "pending" },
    ];
    const next = markUploadQueueProcessing(queue, { currentFile: "ops/b.pdf" });
    expect(next[1].status).toBe("processing");
  });

  test("applyBulkResultsToUploadQueue maps batch results", () => {
    const queue = [
      { id: "1", name: "a.pdf", relativePath: "ops/a.pdf", status: "processing" },
      { id: "2", name: "b.pdf", relativePath: "ops/b.pdf", status: "processing" },
    ];
    const entries = [
      { relativePath: "ops/a.pdf", file: makeFile("a.pdf") },
      { relativePath: "ops/b.pdf", file: makeFile("b.pdf") },
    ];
    const updated = applyBulkResultsToUploadQueue(queue, entries, [
      { ok: true, status: "completed" },
      { ok: false, status: "failed", error: "storage error" },
    ]);
    expect(updated[0].status).toBe("completed");
    expect(updated[1].status).toBe("failed");
    expect(summarizeUploadQueue(updated).failed).toBe(1);
  });
});

describe("AskNacDataVaultPanel upload wiring", () => {
  let panelSource;

  beforeAll(() => {
    panelSource = readFileSync(PANEL_PATH, "utf8");
  });

  test("file input allows multiple selection", () => {
    const fileInput = panelSource.match(/ref=\{fileInputRef\}[\s\S]*?\/>/)?.[0] || "";
    expect(fileInput).toMatch(/\bmultiple\b/);
    expect(fileInput).toMatch(/onChange=\{\(e\) => onFilesChosen\(e\.target\.files\)\}/);
  });

  test("folder input keeps webkitdirectory import path", () => {
    const folderInput = panelSource.match(/ref=\{folderInputRef\}[\s\S]*?\/>/)?.[0] || "";
    expect(folderInput).toMatch(/webkitdirectory/);
    expect(folderInput).toMatch(/onChange=\{\(e\) => onFolderSelected\(e\.target\.files\)\}/);
  });

  test("drag-and-drop uses recursive file collection", () => {
    expect(panelSource).toMatch(/collectFilesFromDataTransfer/);
    expect(panelSource).not.toMatch(/entry\?\.isFile\)\s*\{[\s\S]*?getAsFile/);
  });

  test("single-file upload path preserved", () => {
    expect(panelSource).toMatch(/selection\.mode === "single"/);
    expect(panelSource).toMatch(/registerVaultUpload\(supabase/);
    expect(panelSource).toMatch(/Upload now/);
  });

  test("multi-file selection routes through bulk import", () => {
    expect(panelSource).toMatch(/runBulkImport\(selection\.files/);
    expect(panelSource).toMatch(/startFolderBulkImport/);
  });

  test("upload queue UI is rendered", () => {
    expect(panelSource).toMatch(/nac-ask-vault__upload-queue/);
    expect(panelSource).toMatch(/uploadQueueStats\.pending/);
  });
});
