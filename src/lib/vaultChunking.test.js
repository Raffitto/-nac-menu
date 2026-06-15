import {
  buildCsvChunks,
  buildChunksFromIntermediate,
  buildDocxChunks,
  buildPdfChunks,
  buildXlsxChunks,
  CHUNK_MAX_CHARS,
  detectHeadingSections,
  splitTextIntoChunks,
} from "./vaultChunking";
import { extractDocumentSearchTerms, formatChunkCitation, buildChunkExcerpt } from "../intelligence/askNac/vault/vaultQueryTools";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intelligence/askNac/intentRouter";
import { assessIntentReadinessSync, READINESS } from "../intelligence/askNac/readinessEngine";
import { buildVaultAnswer } from "../intelligence/askNac/vault/vaultAnswerBuilder";
import {
  VAULT_KNOWLEDGE_TIER,
  VAULT_KNOWLEDGE_TIER_LABELS,
  computeVaultKnowledgeTier,
} from "../intelligence/askNac/vault/vaultKnowledgeTier";

describe("vaultChunking CK-3", () => {
  test("splitTextIntoChunks respects paragraph boundaries", () => {
    const text = "First paragraph with terrace AC details.\n\nSecond paragraph about kitchen waste.";
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].chunkText).toContain("terrace AC");
  });

  test("splitTextIntoChunks splits very long text under max chars", () => {
    const longPara = "word ".repeat(2000);
    const chunks = splitTextIntoChunks(longPara);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.chunkText.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    }
  });

  test("buildCsvChunks includes header and row groups", () => {
    const matrix = [
      ["Date", "Branch", "Issue"],
      ["2026-06-01", "Khobar", "terrace AC noise"],
      ["2026-06-02", "Riyadh", "waste pickup delay"],
    ];
    const chunks = buildCsvChunks(matrix);
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkText).toContain("Header: Date | Branch | Issue");
    expect(chunks[0].chunkText).toContain("terrace AC noise");
    expect(chunks[0].sectionLabel).toMatch(/Rows/);
  });

  test("buildXlsxChunks creates per-sheet chunks", () => {
    const chunks = buildXlsxChunks([
      { id: "Sheet1", label: "Operations", lines: ["Line A terrace", "Line B AC unit"] },
      { id: "Sheet2", label: "Finance", lines: ["Revenue row"] },
    ]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.sectionLabel === "Operations")).toBe(true);
    expect(chunks.some((c) => c.sectionLabel === "Finance")).toBe(true);
  });

  test("buildPdfChunks preserves page numbers", () => {
    const chunks = buildPdfChunks([
      { pageNo: 2, label: "Page 2", text: "Terrace AC maintenance note on page two." },
      { pageNo: 3, label: "Page 3", text: "Unrelated content." },
    ]);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const terraceChunk = chunks.find((c) => c.chunkText.includes("Terrace AC"));
    expect(terraceChunk?.pageNo).toBe(2);
  });

  test("buildDocxChunks uses heading sections when detected", () => {
    const intermediate = {
      fileType: "docx",
      text: "Operations Summary\n\nTerrace AC was serviced.\n\nWaste Management\n\nBins emptied on schedule.",
    };
    const sections = detectHeadingSections(intermediate.text.split(/\r?\n/));
    expect(sections.some((s) => s.sectionLabel === "Operations Summary")).toBe(true);
    const chunks = buildDocxChunks(intermediate);
    expect(chunks.some((c) => c.chunkText.includes("Terrace AC"))).toBe(true);
  });

  test("buildChunksFromIntermediate routes by file type", () => {
    const txtChunks = buildChunksFromIntermediate({ fileType: "txt", text: "Hello terrace AC" });
    expect(txtChunks[0].chunkText).toContain("terrace AC");

    const csvChunks = buildChunksFromIntermediate({
      fileType: "csv",
      matrix: [["H"], ["data"]],
    });
    expect(csvChunks[0].chunkText).toContain("Header:");
  });
});

describe("vault_document_search", () => {
  test("routes production document-search phrases over analytics", () => {
    const cases = [
      "Search company knowledge for Google Review",
      "Find mentions of Google Review",
      "Summarize the June 14 Khobar logbook",
      "Search uploaded documents for dinner operation",
    ];
    for (const question of cases) {
      const route = routeAskNacIntent(question);
      expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
    }
  });

  test("extractDocumentSearchTerms strips company knowledge and logbook phrasing", () => {
    expect(extractDocumentSearchTerms("Search company knowledge for Google Review")).toBe("Google Review");
    expect(extractDocumentSearchTerms("Search uploaded documents for dinner operation")).toBe("dinner operation");
    expect(extractDocumentSearchTerms("Summarize the June 14 Khobar logbook")).toBe("June 14 Khobar logbook");
  });

  test("routes find mentions of terrace AC", () => {
    const route = routeAskNacIntent("Find mentions of terrace AC");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
  });

  test("routes search uploaded reports for complaints", () => {
    const route = routeAskNacIntent("Search uploaded reports for complaints");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
  });

  test("extractDocumentSearchTerms strips intent phrasing", () => {
    expect(extractDocumentSearchTerms("Find mentions of terrace AC")).toBe("terrace AC");
    expect(extractDocumentSearchTerms("Search uploaded reports for waste issues")).toBe("waste issues");
    expect(extractDocumentSearchTerms("Find mentions of guest complaints")).toBe("guest complaints");
    expect(extractDocumentSearchTerms("Find mentions of dinner operation")).toBe("dinner operation");
    expect(extractDocumentSearchTerms("Find mentions of Google Review")).toBe("Google Review");
  });

  test("routes logbook keyword document search queries", () => {
    for (const question of [
      "Find mentions of guest complaints",
      "Find mentions of dinner operation",
      "Find mentions of Google Review",
    ]) {
      const route = routeAskNacIntent(question);
      expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
    }
  });

  test("readiness does not require vault period", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH, {
      supabaseConfigured: true,
      question: "Find mentions of terrace AC",
    });
    expect(readiness.status).toBe(READINESS.READY);
    expect(readiness.canQuery).toBe(true);
    expect(readiness.searchTerms).toBe("terrace AC");
  });

  test("document search readiness requires question for term extraction (Edge parity)", () => {
    const withoutQuestion = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH, {
      supabaseConfigured: true,
    });
    expect(withoutQuestion.canQuery).toBe(false);
    expect(withoutQuestion.reasons[0]).toMatch(/extract search terms/i);

    const withQuestion = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH, {
      supabaseConfigured: true,
      question: "Find mentions of Google Review",
    });
    expect(withQuestion.canQuery).toBe(true);
    expect(withQuestion.searchTerms).toBe("Google Review");
  });

  test("buildVaultDocumentSearchAnswer includes summary, excerpt, citation", () => {
    const route = routeAskNacIntent("Find mentions of terrace AC");
    const tool = {
      searchTerms: "terrace AC",
      branchLabel: "Network",
      matches: [
        {
          fileId: "f1",
          fileTitle: "Maintenance Log.pdf",
          pageNo: 4,
          sectionLabel: "Page 4",
          excerpt: "…terrace AC unit serviced…",
          citation: "Maintenance Log.pdf · p. 4 · Page 4",
          reportType: "other",
        },
      ],
      vaultSources: [{ fileId: "f1", title: "Maintenance Log.pdf", reportType: "other" }],
      sources: [{ name: "ask_nac_document_chunks", detail: "FTS" }],
    };
    const answer = buildVaultAnswer(route, tool, { status: READINESS.READY, canQuery: true });
    expect(answer.directAnswer).toContain("terrace AC");
    expect(answer.insights?.[0]).toContain("Maintenance Log.pdf");
    expect(answer.insights?.[0]).toContain("p. 4");
    expect(answer.insights?.[0]).toContain("terrace AC");
    expect(answer.keyMetrics?.[0]?.label).toBe("Maintenance Log.pdf");
  });

  test("buildChunkExcerpt and formatChunkCitation", () => {
    const excerpt = buildChunkExcerpt("The terrace AC unit needs filter replacement soon.", "terrace AC");
    expect(excerpt.toLowerCase()).toContain("terrace ac");
    expect(formatChunkCitation({ fileTitle: "SOP.docx", pageNo: 2, sectionLabel: "HVAC" })).toBe(
      "SOP.docx · p. 2 · HVAC",
    );
  });
});

describe("computeVaultKnowledgeTier searchable", () => {
  test("searchable when search_status is searchable", () => {
    const tier = computeVaultKnowledgeTier({ searchStatus: "searchable", chunkCount: 3 });
    expect(tier.searchable).toBe(true);
    expect(tier.searchableLabel).toBe(VAULT_KNOWLEDGE_TIER_LABELS.searchable);
  });

  test("searchable tier when chunkCount > 0", () => {
    const tier = computeVaultKnowledgeTier({ chunkCount: 5, factsPersisted: 0, readinessStatus: "registered" });
    expect(tier.tier).toBe(VAULT_KNOWLEDGE_TIER.SEARCHABLE);
    expect(tier.searchable).toBe(true);
  });
});
