import {
  PARSEABLE_REPORT_TYPES,
  STORED_ONLY_REPORT_TYPES,
  isLegacyDocFile,
  isSupportedVaultUploadFile,
  isVaultReportTypeParseable,
} from "./vaultConstants";
import {
  VAULT_KNOWLEDGE_TIER,
  VAULT_SEARCH_INDEX_COMING_SOON,
  computeVaultKnowledgeTier,
} from "./vaultKnowledgeTier";
import {
  resolveVaultRegistrationStatus,
} from "./vaultUploadIngestion";
import { partitionVaultUploadFiles, isSupportedFile } from "./vaultBulkIngestion";

describe("vaultConstants CK-1", () => {
  test("PARSEABLE and STORED_ONLY partition all report types", () => {
    expect(PARSEABLE_REPORT_TYPES).toHaveLength(6);
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
