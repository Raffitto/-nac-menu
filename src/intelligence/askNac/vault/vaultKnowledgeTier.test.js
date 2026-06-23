import {
  PARSEABLE_REPORT_TYPES,
  STORED_ONLY_REPORT_TYPES,
  isLegacyDocFile,
  isSupportedVaultUploadFile,
  isVaultReportTypeParseable,
} from "./vaultConstants";
import {
  VAULT_KNOWLEDGE_TIER,
  VAULT_KNOWLEDGE_TIER_LABELS,
  VAULT_SEARCH_INDEX_COMING_SOON,
  computeVaultKnowledgeTier,
  computeVaultSearchIndexStats,
} from "./vaultKnowledgeTier";
import {
  resolveVaultRegistrationStatus,
  buildVaultChunkingSearchWarning,
  resolveVaultUploadWarnings,
} from "./vaultUploadIngestion";
import { partitionVaultUploadFiles, isSupportedFile } from "./vaultBulkIngestion";

describe("vaultConstants CK-1", () => {
  test("PARSEABLE and STORED_ONLY partition all report types", () => {
    expect(PARSEABLE_REPORT_TYPES).toHaveLength(11);
    expect(STORED_ONLY_REPORT_TYPES).toContain("brand_brain_sop");
    expect(STORED_ONLY_REPORT_TYPES).not.toContain("daily_logbook");
  });

  test("rejects legacy .doc and accepts docx", () => {
    expect(isLegacyDocFile("report.doc")).toBe(true);
    expect(isSupportedVaultUploadFile("report.doc")).toBe(false);
    expect(isSupportedVaultUploadFile("report.docx")).toBe(true);
  });

  test("isVaultReportTypeParseable matches parseable list", () => {
    expect(isVaultReportTypeParseable("pnl")).toBe(true);
    expect(isVaultReportTypeParseable("budget")).toBe(false);
  });
});

describe("computeVaultKnowledgeTier", () => {
  test("stored when no facts", () => {
    const tier = computeVaultKnowledgeTier({ factsPersisted: 0, readinessStatus: "registered" });
    expect(tier.tier).toBe(VAULT_KNOWLEDGE_TIER.STORED);
    expect(tier.searchableLabel).toBe(VAULT_SEARCH_INDEX_COMING_SOON);
  });

  test("parsed when facts exist without ready readiness", () => {
    const tier = computeVaultKnowledgeTier({ factsPersisted: 3, readinessStatus: "registered" });
    expect(tier.tier).toBe(VAULT_KNOWLEDGE_TIER.PARSED);
  });

  test("ask-nac-ready when facts and ready readiness", () => {
    const tier = computeVaultKnowledgeTier({ factsPersisted: 8, readinessStatus: "ready" });
    expect(tier.tier).toBe(VAULT_KNOWLEDGE_TIER.ASK_NAC_READY);
    expect(tier.isAskNacReady).toBe(true);
  });

  test("searchable when search_status is searchable", () => {
    const tier = computeVaultKnowledgeTier({ searchStatus: "searchable", chunkCount: 2 });
    expect(tier.searchable).toBe(true);
    expect(tier.searchableLabel).toBe(VAULT_KNOWLEDGE_TIER_LABELS.searchable);
  });
});

describe("computeVaultSearchIndexStats", () => {
  test("returns coming soon when no searchable files", () => {
    const stats = computeVaultSearchIndexStats([
      { searchStatus: "not_searchable", chunkCount: 0 },
    ]);
    expect(stats.label).toBe(VAULT_SEARCH_INDEX_COMING_SOON);
    expect(stats.searchableFiles).toBe(0);
  });

  test("aggregates searchable files and chunk totals", () => {
    const stats = computeVaultSearchIndexStats([
      { searchStatus: "searchable", chunkCount: 12 },
      { searchStatus: "not_searchable", chunkCount: 0 },
      { chunkCount: 3 },
    ]);
    expect(stats.searchableFiles).toBe(2);
    expect(stats.totalChunks).toBe(15);
    expect(stats.label).toBe("2 searchable · 15 chunks");
  });
});

describe("vaultUploadIngestion registration status", () => {
  test("stored-only uploads register as registered not failed", () => {
    expect(resolveVaultRegistrationStatus({ storedOnly: true, ingestion: null })).toBe("registered");
  });

  test("failed parse returns failed", () => {
    expect(
      resolveVaultRegistrationStatus({ storedOnly: false, ingestion: { ok: false } }),
    ).toBe("failed");
  });
});

describe("vault chunking upload warnings", () => {
  test("no warning when chunking succeeded with chunks", () => {
    expect(buildVaultChunkingSearchWarning({ ok: true, chunkCount: 3 })).toBeNull();
  });

  test("warning when chunking failed with reason", () => {
    const warning = buildVaultChunkingSearchWarning({
      ok: false,
      chunkCount: 0,
      error: 'Unsupported file type ".doc" for chunking.',
    });
    expect(warning).toMatch(/search indexing failed/i);
    expect(warning).toContain('Unsupported file type ".doc" for chunking.');
  });

  test("warning when chunking returned no searchable chunks", () => {
    expect(buildVaultChunkingSearchWarning({ ok: true, chunkCount: 0 })).toMatch(
      /search indexing failed/i,
    );
  });

  test("resolveVaultUploadWarnings merges ingestion and chunking warnings", () => {
    const warning = resolveVaultUploadWarnings({
      ingestion: { warning: "Low confidence." },
      chunking: { ok: false, chunkCount: 0, error: "PDF text extraction unavailable." },
    });
    expect(warning).toContain("Low confidence.");
    expect(warning).toContain("search indexing failed");
    expect(warning).toContain("PDF text extraction unavailable.");
  });
});

describe("vaultBulkIngestion partition", () => {
  test("filters legacy doc files from folder list", () => {
    const { legacyDocFiles, entries } = partitionVaultUploadFiles([
      { name: "sop.doc", webkitRelativePath: "ops/sop.doc" },
      { name: "logbook.xlsx", webkitRelativePath: "ops/logbook.xlsx" },
    ]);
    expect(legacyDocFiles).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(isSupportedFile({ name: "notes.doc" })).toBe(false);
  });
});
