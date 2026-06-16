import {
  DOCUMENT_SEARCH_MESSAGES,
  DOCUMENT_SEARCH_STATUS,
  classifyDocumentSearchError,
  rankChunksByTermOverlap,
  tokenizeDocumentSearchQuery,
} from "./vaultDocumentSearchRetrieval";
import {
  buildOperationalSearchDirectAnswer,
  isHeaderOnlyChunk,
  rankDocumentSearchChunks,
  scoreChunkRelevance,
} from "./vaultDocumentSearchRanking";
import { buildVaultDocumentSearchAnswer } from "./vaultAnswerBuilder";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { ANSWER_TYPES, CONFIDENCE_LEVELS } from "../askNacContract";
import { READINESS } from "../readinessEngine";

const LOGBOOK_CHUNKS = [
  {
    chunk_index: 1,
    chunk_text: "[13 June · Khobar] Breakfast\n\nChicken slider unavailable from kitchen.",
    section_label: "Breakfast",
    file: { title: "13 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 2,
    chunk_text: "[13 June · Khobar] Lunch\n\nChicken slider is available at 3 pm.",
    section_label: "Lunch",
    file: { title: "13 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 3,
    chunk_text: "[12 June · Khobar] Complaints\n\nTable 8 complained french toast was cold and undercooked.",
    section_label: "Complaints",
    file: { title: "12 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 4,
    chunk_text: "[12 June · Khobar] Breakfast\n\nLatte had burning taste complaint from table 5.",
    section_label: "Breakfast",
    file: { title: "12 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 5,
    chunk_text: "Complaints",
    section_label: "Complaints",
    file: { title: "14 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 6,
    chunk_text: "[14 June · Khobar] Dinner\n\nTable 15 given feedback food was average and the price was too high according to them.",
    section_label: "Dinner",
    file: { title: "14 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 7,
    chunk_text: "[16 June · Khobar] Staff\n\nLyn on sick leave today, absent from reception shift.",
    section_label: "Staff",
    file: { title: "16 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 8,
    chunk_text: "Google Review 5 Star 5 4 Star 0 3 Star 0 2 Star 0 1 Star 1",
    section_label: "Google Review",
    file: { title: "14 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 9,
    chunk_text: "[14 June · Khobar] Breakfast\n\nItem 86 chicken sliders sold out before lunch service.",
    section_label: "Breakfast",
    file: { title: "14 June NAC Khobar Logbook.docx.pdf" },
  },
];

function topRankedTitle(chunks, query) {
  const ranked = rankDocumentSearchChunks(chunks, query);
  const row = ranked[0]?.row;
  return row?.file?.title || row?.fileTitle || null;
}

function mapMatch(row, searchTerms) {
  const fileTitle = row.file?.title || row.fileTitle;
  return {
    ...row,
    fileTitle,
    chunkText: row.chunk_text,
    excerpt: row.chunk_text?.slice(0, 120),
    citation: `${fileTitle} · ${row.section_label || ""}`,
  };
}

describe("vaultDocumentSearchRanking operational queries", () => {
  test("chicken slider returns 13 June logbook", () => {
    expect(topRankedTitle(LOGBOOK_CHUNKS, "chicken slider")).toContain("13 June");
  });

  test("french toast complaint returns 12 June logbook", () => {
    expect(topRankedTitle(LOGBOOK_CHUNKS, "french toast complaint")).toContain("12 June");
  });

  test("latte complaint returns 12 June logbook", () => {
    expect(topRankedTitle(LOGBOOK_CHUNKS, "latte complaint")).toContain("12 June");
  });

  test("Lyn sick leave returns 16 June logbook", () => {
    expect(topRankedTitle(LOGBOOK_CHUNKS, "Lyn sick leave")).toContain("16 June");
  });

  test("unavailable items matches operational unavailable text", () => {
    const ranked = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "unavailable items");
    expect(ranked[0].row.chunk_text.toLowerCase()).toMatch(/unavailable|sold out|86/);
  });

  test("guest complaints prefers substantive complaint text over header-only chunk", () => {
    const ranked = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "guest complaints");
    expect(isHeaderOnlyChunk(ranked[0].row)).toBe(false);
    expect(ranked[0].row.chunk_text.toLowerCase()).toMatch(/complain|feedback|table/);
  });

  test("food quality issues returns 14 June average/price feedback", () => {
    expect(topRankedTitle(LOGBOOK_CHUNKS, "food quality issues")).toContain("14 June");
    const ranked = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "food average price high");
    expect(ranked[0].row.chunk_text.toLowerCase()).toMatch(/average|price/);
  });

  test("header-only and template chunks are penalized", () => {
    const headerScore = scoreChunkRelevance(LOGBOOK_CHUNKS[4], { coreTokens: ["complaint"], phrases: ["complaint"], expandedTokens: ["complaint"] });
    const bodyScore = scoreChunkRelevance(LOGBOOK_CHUNKS[3], { coreTokens: ["latte", "complaint"], phrases: ["latte complaint"], expandedTokens: ["latte", "complaint"] });
    expect(bodyScore).toBeGreaterThan(headerScore);
  });

  test("tokenizeDocumentSearchQuery expands complaint variants", () => {
    const tokens = tokenizeDocumentSearchQuery("guest complaints");
    expect(tokens).toEqual(expect.arrayContaining(["complaint", "complaints", "complained", "feedback"]));
  });

  test("buildOperationalSearchDirectAnswer synthesizes evidence for chicken slider", () => {
    const ranked = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "chicken slider")
      .map((entry) => mapMatch(entry.row, "chicken slider"));
    const answer = buildOperationalSearchDirectAnswer("chicken slider", ranked);
    expect(answer).toMatch(/13 June NAC Khobar Logbook/i);
    expect(answer.toLowerCase()).toMatch(/chicken slider/);
    expect(answer.toLowerCase()).toMatch(/unavailable|available/);
  });
});

describe("vaultDocumentSearchRetrieval", () => {
  test("rankChunksByTermOverlap prefers guest complaint feedback chunk", () => {
    const tokens = tokenizeDocumentSearchQuery("guest complaints");
    const ranked = rankChunksByTermOverlap(LOGBOOK_CHUNKS, tokens, "guest complaints");
    expect(ranked[0].chunk_text).toMatch(/complain|feedback|table/i);
  });

  test("classifyDocumentSearchError distinguishes auth from connection", () => {
    expect(classifyDocumentSearchError({ message: "permission denied for table" })).toBe(
      DOCUMENT_SEARCH_STATUS.AUTH_ERROR,
    );
    expect(classifyDocumentSearchError({ message: "fetch failed" })).toBe(
      DOCUMENT_SEARCH_STATUS.CONNECTION_ERROR,
    );
  });
});

describe("buildVaultDocumentSearchAnswer messaging", () => {
  test("successful empty search uses document_no_match not connection error", () => {
    const route = routeAskNacIntent("Find mentions of terrace AC");
    const answer = buildVaultDocumentSearchAnswer(
      route,
      {
        searchTerms: "terrace AC",
        queryStatus: DOCUMENT_SEARCH_STATUS.NO_MATCH,
        matches: [],
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.answerType).toBe(ANSWER_TYPES.DOCUMENT_NO_MATCH);
    expect(answer.directAnswer).toBe(DOCUMENT_SEARCH_MESSAGES.NO_MATCH);
  });

  test("operational evidence uses assistant-style direct answer with high confidence", () => {
    const route = routeAskNacIntent("Search company knowledge for chicken slider");
    const matches = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "chicken slider")
      .map((entry) => ({ ...mapMatch(entry.row, "chicken slider"), relevanceScore: entry.relevanceScore }));
    const answer = buildVaultDocumentSearchAnswer(
      route,
      {
        searchTerms: "chicken slider",
        queryStatus: DOCUMENT_SEARCH_STATUS.OK,
        matches,
        searchMethod: "fallback",
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.directAnswer).toMatch(/13 June NAC Khobar Logbook/i);
    expect(answer.directAnswer.toLowerCase()).toMatch(/chicken slider/);
    expect(answer.confidence).toBe(CONFIDENCE_LEVELS.HIGH);
    expect(answer.answerType).not.toBe(ANSWER_TYPES.DOCUMENT_NO_MATCH);
  });
});
