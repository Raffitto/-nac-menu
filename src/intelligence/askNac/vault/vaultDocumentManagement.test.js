import {
  archiveVaultDocument,
  buildVaultDuplicateSkipResult,
  deleteVaultDocument,
  downloadVaultOriginalFile,
  formatVaultDocumentManagementRow,
  rebuildVaultDocumentSearchIndex,
  rebuildVaultDocumentSearchIndexBulk,
  reindexExistingVaultDocument,
  vaultCanDeleteDocuments,
  vaultCanManageDocuments,
  VAULT_BULK_REINDEX_MAX,
} from "./vaultDocumentManagement";
import { RBAC_ROLES } from "../../../dashboard/config/rbac";

jest.mock("../../../lib/vaultChunking", () => ({
  runVaultDocumentChunking: jest.fn(),
}));

const { runVaultDocumentChunking } = require("../../../lib/vaultChunking");

const FILE_RECORD = {
  id: "file-1",
  original_filename: "13_June.pdf",
  storage_bucket: "ask-nac-vault-originals",
  storage_path: "khobar/operations/file-1/13_June.pdf",
  report_type: "daily_logbook",
  status: "active",
  uploader_email: "uploader@nac.com",
};

function buildSupabase({
  fileRecord = FILE_RECORD,
  versionId = "ver-1",
  chunkDeleteError = null,
  fileUpdateError = null,
} = {}) {
  const accessLogInsert = jest.fn().mockResolvedValue({ error: null });
  const chunkDelete = jest.fn().mockResolvedValue({ error: chunkDeleteError });
  const fileUpdate = jest.fn().mockResolvedValue({ error: fileUpdateError });

  return {
    from: jest.fn((table) => {
      if (table === "ask_nac_files") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: fileRecord, error: null }),
              }),
              maybeSingle: jest.fn().mockResolvedValue({ data: fileRecord, error: null }),
            }),
          }),
          update: jest.fn((payload) => ({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockImplementation(async () => {
                fileUpdate(payload);
                return { error: fileUpdateError };
              }),
            }),
          })),
        };
      }
      if (table === "ask_nac_file_versions") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({ data: { id: versionId }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "ask_nac_document_chunks") {
        return {
          delete: jest.fn().mockReturnValue({
            eq: jest.fn().mockImplementation(async () => chunkDelete()),
          }),
        };
      }
      if (table === "ask_nac_file_access_log") {
        return { insert: accessLogInsert };
      }
      return {};
    }),
    storage: {
      from: jest.fn().mockReturnValue({
        download: jest.fn().mockResolvedValue({
          data: new Blob(["pdf-bytes"], { type: "application/pdf" }),
          error: null,
        }),
        remove: jest.fn().mockResolvedValue({ error: null }),
      }),
    },
    _chunkDelete: chunkDelete,
    _fileUpdate: fileUpdate,
    _accessLogInsert: accessLogInsert,
  };
}

describe("vaultDocumentManagement permissions", () => {
  test("vaultCanManageDocuments allows super_admin and developer", () => {
    expect(vaultCanManageDocuments({ vaultRole: "super_admin" })).toBe(true);
    expect(vaultCanManageDocuments({ rbacRole: RBAC_ROLES.DEVELOPER })).toBe(true);
    expect(vaultCanManageDocuments({ vaultRole: "branch_manager" })).toBe(false);
  });

  test("vaultCanDeleteDocuments is stricter than manage", () => {
    expect(vaultCanDeleteDocuments({ vaultRole: "ceo" })).toBe(false);
    expect(vaultCanDeleteDocuments({ vaultRole: "super_admin" })).toBe(true);
    expect(vaultCanDeleteDocuments({ rbacRole: RBAC_ROLES.DEVELOPER })).toBe(true);
  });
});

describe("buildVaultDuplicateSkipResult", () => {
  test("duplicate upload skip message includes re-index option", () => {
    const result = buildVaultDuplicateSkipResult({
      duplicateDecision: {
        action: "skip_duplicate",
        reason: "Identical content already ingested.",
        existingFileId: "file-1",
      },
      existingFile: { id: "file-1", title: "June Logbook", original_filename: "13_June.pdf" },
    });

    expect(result.skipped).toBe(true);
    expect(result.skipMessage).toBe("Skipped: already exists");
    expect(result.canReindex).toBe(true);
    expect(result.canUploadNewVersion).toBe(false);
    expect(result.existingFile.originalFilename).toBe("13_June.pdf");
  });
});

describe("formatVaultDocumentManagementRow", () => {
  test("maps registry fields for management table", () => {
    const row = formatVaultDocumentManagementRow({
      id: "abc",
      original_filename: "logbook.pdf",
      report_type: "daily_logbook",
      primary_branch_id: "khobar",
      created_at: "2026-06-13T00:00:00Z",
      search_status: "searchable",
      chunk_count: 12,
      searchable_at: "2026-06-14T10:00:00Z",
      parsingStatus: "registered",
      factsPersisted: 0,
    });

    expect(row.filename).toBe("logbook.pdf");
    expect(row.searchable).toBe(true);
    expect(row.chunkCount).toBe(12);
    expect(row.lastIndexedAt).toBe("2026-06-14T10:00:00Z");
  });
});

describe("rebuildVaultDocumentSearchIndex", () => {
  beforeEach(() => {
    runVaultDocumentChunking.mockReset();
    runVaultDocumentChunking.mockResolvedValue({
      ok: true,
      chunkCount: 8,
      searchableAt: "2026-06-16T12:00:00Z",
    });
  });

  test("re-index existing document runs chunking on downloaded original", async () => {
    const supabase = buildSupabase();
    const result = await rebuildVaultDocumentSearchIndex(supabase, {
      fileId: "file-1",
      session: { user: { email: "dev@nac.com" } },
      vaultRole: "super_admin",
    });

    expect(result.ok).toBe(true);
    expect(result.chunkCount).toBe(8);
    expect(runVaultDocumentChunking).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ fileId: "file-1", versionRowId: "ver-1" }),
    );
    expect(supabase._accessLogInsert).toHaveBeenCalled();
  });

  test("blocks re-index without admin permission", async () => {
    const result = await rebuildVaultDocumentSearchIndex(buildSupabase(), {
      fileId: "file-1",
      session: { user: { email: "staff@nac.com" } },
      vaultRole: "staff",
      rbacRole: RBAC_ROLES.BRANCH_GM,
    });
    expect(result.ok).toBe(false);
    expect(runVaultDocumentChunking).not.toHaveBeenCalled();
  });
});

describe("reindexExistingVaultDocument", () => {
  beforeEach(() => {
    runVaultDocumentChunking.mockReset();
    runVaultDocumentChunking.mockResolvedValue({ ok: true, chunkCount: 5 });
  });

  test("uploader can re-index own duplicate without admin role", async () => {
    const supabase = buildSupabase({
      fileRecord: { ...FILE_RECORD, uploader_email: "uploader@nac.com" },
    });

    const result = await reindexExistingVaultDocument(supabase, {
      fileId: "file-1",
      session: { user: { email: "uploader@nac.com" } },
      vaultRole: "branch_manager",
    });

    expect(result.ok).toBe(true);
    expect(runVaultDocumentChunking).toHaveBeenCalled();
  });
});

describe("archiveVaultDocument", () => {
  test("archived document removes chunks and updates status", async () => {
    const supabase = buildSupabase();
    const result = await archiveVaultDocument(supabase, {
      fileId: "file-1",
      session: { user: { email: "ceo@nac.com" } },
      vaultRole: "ceo",
    });

    expect(result.ok).toBe(true);
    expect(supabase._chunkDelete).toHaveBeenCalled();
    expect(supabase._fileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "archived",
        search_status: "not_searchable",
        chunk_count: 0,
      }),
    );
  });
});

describe("deleteVaultDocument", () => {
  test("delete requires developer permission", async () => {
    const result = await deleteVaultDocument(buildSupabase(), {
      fileId: "file-1",
      session: { user: { email: "ceo@nac.com" } },
      vaultRole: "ceo",
    });
    expect(result.ok).toBe(false);
  });
});

describe("rebuildVaultDocumentSearchIndexBulk", () => {
  beforeEach(() => {
    runVaultDocumentChunking.mockReset();
    runVaultDocumentChunking.mockResolvedValue({ ok: true, chunkCount: 3 });
  });

  test("bulk re-index caps at max batch size", async () => {
    const ids = Array.from({ length: VAULT_BULK_REINDEX_MAX + 1 }, (_, i) => `id-${i}`);
    const result = await rebuildVaultDocumentSearchIndexBulk(buildSupabase(), {
      fileIds: ids,
      session: { user: { email: "dev@nac.com" } },
      vaultRole: "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Maximum/);
  });
});

describe("downloadVaultOriginalFile", () => {
  test("wraps storage blob as File", async () => {
    const supabase = buildSupabase();
    const { file, error } = await downloadVaultOriginalFile(supabase, {
      storage_path: "khobar/ops/x/doc.pdf",
      original_filename: "doc.pdf",
    });

    expect(error).toBeNull();
    expect(file.name).toBe("doc.pdf");
  });
});

describe("archived document excluded from search", () => {
  test("archive clears chunks so search index has no rows", async () => {
    const supabase = buildSupabase();
    await archiveVaultDocument(supabase, {
      fileId: "file-1",
      session: { user: { email: "dev@nac.com" } },
      rbacRole: RBAC_ROLES.DEVELOPER,
    });

    expect(supabase._chunkDelete).toHaveBeenCalled();
    expect(supabase._fileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived", chunk_count: 0 }),
    );
  });
});
