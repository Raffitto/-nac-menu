import {
  buildCsvChunks,
  buildChunksFromIntermediate,
  buildDocxChunks,
  buildLogbookChunks,
  buildPdfChunks,
  buildXlsxChunks,
  CHUNK_MAX_CHARS,
  detectHeadingSections,
  detectLogbookSections,
  isLogbookContent,
  splitTextIntoChunks,
} from "./vaultChunking";
import { extractDocumentSearchTerms, formatChunkCitation, buildChunkExcerpt } from "../intelligence/askNac/vault/vaultQueryTools";
import {
  extractDocumentSummarySubject,
  isVaultDocumentSummaryQuery,
} from "../intelligence/askNac/vault/vaultDocumentSummaryRouting";
import { buildDocumentSummaryAnswerContent } from "../intelligence/askNac/vault/vaultDocumentSummary";
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

  test("detectLogbookSections splits breakfast lunch dinner sections", () => {
    const lines = [
      "Breakfast",
      "Chicken slider unavailable from kitchen.",
      "Lunch",
      "Chicken slider is available at 3 pm.",
      "Google Review",
      "5 Star 5",
    ];
    const sections = detectLogbookSections(lines);
    expect(sections.map((s) => s.sectionLabel)).toEqual(
      expect.arrayContaining(["Breakfast", "Lunch", "Google Review"]),
    );
  });

  test("buildLogbookChunks includes date branch metadata and section labels", () => {
    const intermediate = {
      text: "Breakfast\nChicken slider unavailable.\n\nLunch\nChicken slider available at 3 pm.",
    };
    const chunks = buildLogbookChunks(intermediate, {
      originalFilename: "13 June NAC Khobar Logbook.docx.pdf",
      branchId: "khobar",
      reportType: "daily_logbook",
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].chunkText).toMatch(/13 June/i);
    expect(chunks[0].chunkText).toMatch(/Khobar/i);
    expect(chunks[0].sectionLabel).toBe("Breakfast");
    expect(chunks.some((c) => c.sectionLabel === "Lunch")).toBe(true);
  });

  test("isLogbookContent detects logbook filenames and report type", () => {
    expect(isLogbookContent({ text: "Breakfast\nLunch" }, { originalFilename: "14 June NAC Khobar Logbook.pdf" })).toBe(true);
    expect(isLogbookContent({ text: "Breakfast\ncomplaints" }, { reportType: "daily_logbook" })).toBe(true);
  });
});

describe("vault_document_search", () => {
  test("routes production document-search phrases over analytics", () => {
    const cases = [
      "Search company knowledge for Google Review",
      "Find mentions of Google Review",
      "Search uploaded documents for dinner operation",
    ];
    for (const question of cases) {
      const route = routeAskNacIntent(question);
      expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
    }
  });

  test("extractDocumentSearchTerms strips company knowledge phrasing", () => {
    expect(extractDocumentSearchTerms("Search company knowledge for Google Review")).toBe("Google Review");
    expect(extractDocumentSearchTerms("Search uploaded documents for dinner operation")).toBe("dinner operation");
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

describe("vault_document_summary", () => {
  const docContext = {
    fileIds: ["file-khobar-june14"],
    fileTitles: ["14 June NAC Khobar Logbook.docx.pdf"],
    searchTerms: "Google Review",
  };

  test("routes direct logbook summary phrases", () => {
    for (const question of [
      "Summarize the June 14 Khobar logbook",
      "Summarize this document",
      "Provide an executive summary",
      "Key takeaways",
      "What should management know?",
    ]) {
      const route = routeAskNacIntent(question, { documentContext: docContext });
      expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY);
    }
  });

  test("routes follow-up summary after document search context", () => {
    const route = routeAskNacIntent("Summarize this document", { documentContext: docContext });
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.UNKNOWN);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS);
  });

  test("extractDocumentSummarySubject strips summary phrasing", () => {
    expect(extractDocumentSummarySubject("Summarize the June 14 Khobar logbook")).toBe("June 14 Khobar logbook");
    expect(extractDocumentSummarySubject("Provide an executive summary of the Khobar logbook")).toContain("Khobar");
  });

  test("readiness does not require metric period or structured facts", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY, {
      supabaseConfigured: true,
      question: "Summarize this document",
    });
    expect(readiness.status).toBe(READINESS.READY);
    expect(readiness.canQuery).toBe(true);
    expect(readiness.note).toMatch(/no structured facts/i);
  });

  test("buildVaultDocumentSummaryAnswer includes executive summary with citations", () => {
    const route = routeAskNacIntent("Summarize the June 14 Khobar logbook");
    const tool = {
      fileTitles: ["14 June NAC Khobar Logbook.docx.pdf"],
      branchLabel: "Khobar",
      queryStatus: "ok",
      chunks: [
        {
          fileId: "file-khobar-june14",
          fileTitle: "14 June NAC Khobar Logbook.docx.pdf",
          chunkText: "Google Review score improved after dinner service recovery.",
          pageNo: 2,
          sectionLabel: "Dinner",
          citation: "14 June NAC Khobar Logbook.docx.pdf · p. 2 · Dinner",
        },
        {
          fileId: "file-khobar-june14",
          fileTitle: "14 June NAC Khobar Logbook.docx.pdf",
          chunkText: "MOD noted terrace AC maintenance completed before service.",
          pageNo: 3,
          sectionLabel: "Operations",
          citation: "14 June NAC Khobar Logbook.docx.pdf · p. 3 · Operations",
        },
      ],
      vaultSources: [{ fileId: "file-khobar-june14", title: "14 June NAC Khobar Logbook.docx.pdf" }],
    };
    const answer = buildVaultAnswer(route, tool, { status: READINESS.READY, canQuery: true });
    expect(answer.answerType).toBe("executive");
    expect(answer.directAnswer).toMatch(/Executive summary/i);
    expect(answer.directAnswer).toContain("14 June NAC Khobar Logbook");
    expect(answer.insights?.[0]).toContain("[14 June NAC Khobar Logbook.docx.pdf · p. 2 · Dinner]");
    expect(answer.recommendations?.[0]).toMatch(/Sources:/);
  });

  test("buildDocumentSummaryAnswerContent produces citation-backed insights", () => {
    const summary = buildDocumentSummaryAnswerContent({
      chunks: [
        {
          fileTitle: "Logbook.pdf",
          chunkText: "Guest complaints were resolved at reception.",
          pageNo: 1,
          sectionLabel: "Reception",
          citation: "Logbook.pdf · p. 1 · Reception",
        },
      ],
      fileTitles: ["Logbook.pdf"],
      branchLabel: "Khobar",
    });
    expect(summary.insights[0]).toContain("[Logbook.pdf · p. 1 · Reception]");
    expect(summary.recommendations[0]).toContain("Logbook.pdf · p. 1 · Reception");
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
