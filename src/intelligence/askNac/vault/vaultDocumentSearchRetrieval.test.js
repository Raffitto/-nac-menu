import {
  DOCUMENT_SEARCH_MESSAGES,
  DOCUMENT_SEARCH_STATUS,
  classifyDocumentSearchError,
  rankChunksByTermOverlap,
  scoreChunkTermOverlap,
  tokenizeDocumentSearchQuery,
} from "./vaultDocumentSearchRetrieval";
import { buildVaultDocumentSearchAnswer } from "./vaultAnswerBuilder";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { ANSWER_TYPES } from "../askNacContract";
import { READINESS } from "../readinessEngine";

const SAMPLE_CHUNKS = [
  {
    chunk_index: 1,
    chunk_text: "Table 15 given feedback food was average and the price was too high according to them.",
  },
  {
    chunk_index: 2,
    chunk_text: "Lunch operation was very quiet we had few reservations and accept all the walkin",
  },
  {
    chunk_index: 3,
    chunk_text: "Google Review 5 Star 5 4 Star 0 3 Star 0 2 Star 0 1 Star 1",
  },
];

describe("vaultDocumentSearchRetrieval", () => {
  test("tokenizeDocumentSearchQuery expands operational aliases", () => {
    const tokens = tokenizeDocumentSearchQuery("guest complaints");
    expect(tokens).toEqual(expect.arrayContaining(["guest", "complaints", "feedback"]));
  });

  test("scoreChunkTermOverlap ranks food quality against average food text", () => {
    const tokens = tokenizeDocumentSearchQuery("food quality issues");
    const score = scoreChunkTermOverlap(SAMPLE_CHUNKS[0].chunk_text, tokens);
    expect(score).toBeGreaterThan(0);
  });

  test("rankChunksByTermOverlap prefers guest complaint feedback chunk", () => {
    const tokens = tokenizeDocumentSearchQuery("guest complaints");
    const ranked = rankChunksByTermOverlap(SAMPLE_CHUNKS, tokens);
    expect(ranked[0].chunk_text).toMatch(/feedback/i);
  });

  test("rankChunksByTermOverlap matches service issues via feedback alias", () => {
    const tokens = tokenizeDocumentSearchQuery("service issues");
    const ranked = rankChunksByTermOverlap(SAMPLE_CHUNKS, tokens);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].chunk_text).toMatch(/feedback|operation/i);
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

  test("connection failure uses explicit connection message", () => {
    const route = routeAskNacIntent("Find mentions of terrace AC");
    const answer = buildVaultDocumentSearchAnswer(
      route,
      {
        searchTerms: "terrace AC",
        queryStatus: DOCUMENT_SEARCH_STATUS.CONNECTION_ERROR,
        matches: [],
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.answerType).toBe(ANSWER_TYPES.ERROR);
    expect(answer.directAnswer).toBe(DOCUMENT_SEARCH_MESSAGES.CONNECTION_FAILED);
  });
});
