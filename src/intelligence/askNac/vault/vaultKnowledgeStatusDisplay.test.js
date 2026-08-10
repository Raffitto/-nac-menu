import {
  averageBranchCoveragePercent,
  formatCoveragePercentLabel,
  formatStatusCount,
  KNOWLEDGE_TIMESTAMP_LABELS,
  latestTimestamp,
  resolveKnowledgeContentUpdatedAt,
} from "./vaultKnowledgeStatusDisplay";
import { fetchCoverageDashboardData } from "./vaultCoverageDashboard";
import { isVaultJunkFilename } from "./vaultDocumentManagement";
import { VAULT_KNOWLEDGE_TIER_LABELS } from "./vaultKnowledgeTier";
import {
  listVaultFiles,
  VAULT_REGISTRY_PAGE_SIZE,
  fetchVaultKnowledgeStats,
} from "../../../lib/askNacVaultApi";
import { vaultCanManageDocuments } from "./vaultDocumentManagement";
import { RBAC_ROLES } from "../../../dashboard/config/rbac";
import fs from "fs";
import path from "path";

const panelPath = path.join(
  __dirname,
  "../../../dashboard/intelligence/AskNacDataVaultPanel.jsx",
);

describe("coverage display semantics", () => {
  test("coverage query failure → Unavailable, not 0%", () => {
    expect(formatCoveragePercentLabel({ available: false, score: 0 })).toBe("Unavailable");
    expect(formatCoveragePercentLabel({ available: false, score: null })).toBe("Unavailable");
    expect(averageBranchCoveragePercent({
      khobar: { overallScore: 0 },
      riyadh: { overallScore: 0 },
      jeddah: { overallScore: 0 },
    }, { available: false })).toBeNull();
  });

  test("valid actual zero coverage → 0%", () => {
    expect(formatCoveragePercentLabel({ available: true, score: 0 })).toBe("0%");
    expect(averageBranchCoveragePercent({
      khobar: { overallScore: 0 },
      riyadh: { overallScore: 0 },
      jeddah: { overallScore: 0 },
    }, { available: true })).toBe(0);
  });

  test("successful coverage average renders percent", () => {
    expect(averageBranchCoveragePercent({
      khobar: { overallScore: 80 },
      riyadh: { overallScore: 70 },
      jeddah: { overallScore: 90 },
    }, { available: true })).toBe(80);
    expect(formatCoveragePercentLabel({ available: true, score: 82 })).toBe("82%");
  });
});

describe("status count failure semantics", () => {
  test("registry/stats error does not create fake zero count", () => {
    expect(formatStatusCount(null, { unavailable: true })).toBe("Unavailable");
    expect(formatStatusCount(undefined, { unavailable: false })).toBe("Unavailable");
    expect(formatStatusCount(555, { unavailable: false })).toBe("555");
    expect(formatStatusCount(0, { unavailable: false })).toBe("0");
  });
});

describe("sync timestamp labels", () => {
  test("labels map to distinct source fields", () => {
    expect(KNOWLEDGE_TIMESTAMP_LABELS.lastScheduledCheck).toBe("Last scheduled check");
    expect(KNOWLEDGE_TIMESTAMP_LABELS.lastSuccessfulIngest).toBe("Last successful ingest");
    expect(KNOWLEDGE_TIMESTAMP_LABELS.lastContentUpdate).toBe("Last content update");

    const panel = fs.readFileSync(panelPath, "utf8");
    expect(panel).toMatch(/KNOWLEDGE_TIMESTAMP_LABELS\.lastScheduledCheck/);
    expect(panel).toMatch(/KNOWLEDGE_TIMESTAMP_LABELS\.lastSuccessfulIngest/);
    expect(panel).toMatch(/KNOWLEDGE_TIMESTAMP_LABELS\.lastContentUpdate/);
    expect(panel).toMatch(/driveLastScheduledCheckAt/);
    expect(panel).toMatch(/driveLastSuccessfulIngestAt/);
    expect(panel).toMatch(/last_sync_at/);
    expect(panel).toMatch(/last_ingest_at/);
  });

  test("content update prefers searchable_at then updated_at", () => {
    expect(resolveKnowledgeContentUpdatedAt({
      searchable_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-09T00:00:00Z",
      created_at: "2026-08-01T00:00:00Z",
    })).toBe("2026-08-10T00:00:00Z");
    expect(latestTimestamp(["2026-08-01T00:00:00Z", null, "2026-08-09T12:00:00Z"]))
      .toBe("2026-08-09T12:00:00Z");
  });
});

describe("coverage fetch timeout safety", () => {
  test("does not scan structured_facts table", async () => {
    const calls = [];
    const supabase = {
      from(table) {
        calls.push(table);
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    };

    const result = await fetchCoverageDashboardData(supabase);
    expect(calls).toEqual(["ask_nac_data_coverage"]);
    expect(calls).not.toContain("ask_nac_structured_facts");
    expect(result.available).toBe(true);
  });

  test("coverage error returns available=false without inventing branch zeros for UI", async () => {
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          limit() {
            return Promise.resolve({
              data: null,
              error: { message: "canceling statement due to statement timeout" },
            });
          },
        };
      },
    };

    const result = await fetchCoverageDashboardData(supabase);
    expect(result.available).toBe(false);
    expect(result.error).toMatch(/statement timeout/);
    expect(formatCoveragePercentLabel({
      available: result.available,
      score: averageBranchCoveragePercent(result.branches, { available: result.available }),
    })).toBe("Unavailable");
  });
});

describe("registry pagination bound", () => {
  test("listVaultFiles uses bounded range page size", async () => {
    expect(VAULT_REGISTRY_PAGE_SIZE).toBeLessThanOrEqual(100);
    let rangeArgs = null;
    const supabase = {
      from() {
        return {
          select() {
            return this;
          },
          order() {
            return this;
          },
          eq() {
            return this;
          },
          range(from, to) {
            rangeArgs = [from, to];
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    };

    const result = await listVaultFiles(supabase, {
      limit: VAULT_REGISTRY_PAGE_SIZE,
      offset: 50,
      status: "active",
    });
    expect(rangeArgs).toEqual([50, 50 + VAULT_REGISTRY_PAGE_SIZE - 1]);
    expect(result.hasMore).toBe(false);
    expect(result.error).toBeNull();
  });

  test("panel wires Load more documents for pagination", () => {
    const panel = fs.readFileSync(panelPath, "utf8");
    expect(panel).toMatch(/VAULT_REGISTRY_PAGE_SIZE/);
    expect(panel).toMatch(/loadMoreRegistry/);
    expect(panel).toMatch(/Load more documents/);
    expect(panel).toMatch(/offset:/);
  });
});

describe("top-level counts survive coverage failure", () => {
  test("panel keeps aggregate counts when coverage unavailable", () => {
    const panel = fs.readFileSync(panelPath, "utf8");
    expect(panel).toMatch(/Coverage summary unavailable — showing counts only/);
    expect(panel).toMatch(/coverageAvailable/);
    expect(panel).toMatch(/formatCoveragePercentLabel/);
    expect(panel).toMatch(/formatStatusCount\(knowledgeStats\.documentsStored/);
    expect(panel).not.toMatch(/knowledgeStats\.coveragePct\}%/);
  });
});

describe("structured label wording", () => {
  test("Parsed UI label is Structured for facts semantics", () => {
    expect(VAULT_KNOWLEDGE_TIER_LABELS.parsed).toBe("Structured");
    const panel = fs.readFileSync(panelPath, "utf8");
    expect(panel).toMatch(/Structured reports/);
    expect(panel).toMatch(/>Structured</);
    expect(panel).not.toMatch(/Reports Parsed/);
  });
});

describe("compiler-stage junk filter", () => {
  test("hides compiler-stage verify artifacts from normal registry", () => {
    expect(isVaultJunkFilename("compiler-stage-verify-1782333466189.txt")).toBe(true);
    expect(isVaultJunkFilename("13_June_NAC_Khobar_Logbook.docx.pdf")).toBe(false);
  });
});

describe("RBAC intact", () => {
  test("document management roles unchanged", () => {
    expect(vaultCanManageDocuments({ vaultRole: "ceo" })).toBe(true);
    expect(vaultCanManageDocuments({ rbacRole: RBAC_ROLES.DEVELOPER })).toBe(true);
    expect(vaultCanManageDocuments({ vaultRole: "viewer", rbacRole: "staff" })).toBe(false);
  });
});

describe("stats partial success", () => {
  test("fetchVaultKnowledgeStats keeps successful counts when one query fails", async () => {
    const supabase = {
      from(table) {
        const chain = {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          gt() {
            return this;
          },
          not() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            if (table === "ask_nac_files") {
              return Promise.resolve({
                data: { created_at: "2026-08-10T00:00:00Z", searchable_at: null, updated_at: "2026-08-10T00:00:00Z" },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (table === "ask_nac_data_coverage") {
              return resolve({
                count: null,
                error: { message: "canceling statement due to statement timeout" },
              });
            }
            if (table === "ask_nac_document_chunks") {
              return resolve({ count: 1177, error: null });
            }
            // ask_nac_files head counts
            return resolve({ count: 555, error: null });
          },
        };
        return chain;
      },
    };

    const result = await fetchVaultKnowledgeStats(supabase);
    expect(result.ok).toBe(true);
    expect(result.stats.documentsStored).toBe(555);
    expect(result.stats.totalChunks).toBe(1177);
    expect(result.stats.reportsParsed).toBeNull();
  });
});
