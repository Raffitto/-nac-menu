import { buildOperationalManagerAnswer } from "./vaultOperationalIntelligence";
import { rankDocumentSearchChunks, buildOperationalSearchDirectAnswer } from "./vaultDocumentSearchRanking";
import { buildVaultDocumentSearchAnswer, buildVaultCashUpAnswer, buildVaultOperationalReviewAnswer } from "./vaultAnswerBuilder";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { buildSalesPerformanceExecutiveSummary, buildSalesPerformanceSearchableText } from "./vaultSalesPerformanceIntelligence";
import { isVaultJunkFilename } from "./vaultDocumentManagement";
import { buildSalesPerformanceSearchableChunks } from "../../../lib/vaultChunking";
import { createIntermediate } from "./parsers/vaultIntermediate";
import { CONFIDENCE_LEVELS } from "../askNacContract";
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
    chunk_text: "[12 June · Khobar] Complaints\n\nTable 8 complained french toast was too soft and juicy, removed from bill.",
    section_label: "Complaints",
    file: { title: "12 June NAC Khobar Logbook.docx.pdf" },
  },
  {
    chunk_index: 4,
    chunk_text: "[12 June · Khobar] Breakfast\n\nLatte had burning taste complaint from table 5, remade and guest satisfied.",
    section_label: "Breakfast",
    file: { title: "12 June NAC Khobar Logbook.docx.pdf" },
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
];

function mapMatch(row, searchTerms) {
  return {
    ...row,
    fileTitle: row.file?.title,
    chunkText: row.chunk_text,
    excerpt: row.chunk_text,
    citation: `${row.file?.title} · ${row.section_label}`,
    relevanceScore: rankDocumentSearchChunks([row], searchTerms)[0]?.relevanceScore ?? 0,
  };
}

function topTitle(query) {
  const ranked = rankDocumentSearchChunks(LOGBOOK_CHUNKS, query);
  return ranked[0]?.row.file?.title || null;
}

describe("Company Knowledge benchmark logbooks", () => {
  test("chicken slider -> 13 June logbook", () => {
    expect(topTitle("chicken slider")).toContain("13 June");
    const matches = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "chicken slider").map((e) => mapMatch(e.row, "chicken slider"));
    const answer = buildOperationalSearchDirectAnswer("chicken slider", matches);
    expect(answer.toLowerCase()).toMatch(/unavailable|available/);
  });

  test("french toast complaint -> 12 June logbook", () => {
    expect(topTitle("french toast complaint")).toContain("12 June");
  });

  test("latte complaint -> 12 June logbook", () => {
    expect(topTitle("latte complaint")).toContain("12 June");
  });

  test("Lyn sick leave -> 16 June logbook", () => {
    expect(topTitle("Lyn sick leave")).toContain("16 June");
  });

  test("food average price high -> 14 June logbook", () => {
    expect(topTitle("food average price high")).toContain("14 June");
  });
});

describe("manager-style operational answers", () => {
  test("includes management note and related findings for chicken slider", () => {
    const matches = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "chicken slider").map((e) => mapMatch(e.row, "chicken slider"));
    const manager = buildOperationalManagerAnswer("chicken slider", matches);
    expect(manager.answer.toLowerCase()).toMatch(/chicken slider/);
    expect(manager.managementNote).toMatch(/temporary availability/i);
    expect(manager.source).toMatch(/13 June/i);
  });

  test("buildVaultDocumentSearchAnswer uses manager format sections", () => {
    const route = routeAskNacIntent("Search company knowledge for chicken slider");
    const matches = rankDocumentSearchChunks(LOGBOOK_CHUNKS, "chicken slider").map((e) => ({
      ...mapMatch(e.row, "chicken slider"),
      relevanceScore: e.relevanceScore,
    }));
    const answer = buildVaultDocumentSearchAnswer(route, { searchTerms: "chicken slider", matches, queryStatus: "ok" }, { status: READINESS.READY });
    expect(answer.directAnswer).toMatch(/Answer:/);
    expect(answer.directAnswer).toMatch(/Management note:/);
    expect(answer.directAnswer).toMatch(/Confidence:/);
    expect(answer.confidence).toBe(CONFIDENCE_LEVELS.HIGH);
  });
});

describe("cross-document operational review routing", () => {
  test("what complaints happened this week routes to operational review", () => {
    const route = routeAskNacIntent("What complaints happened this week?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW);
  });

  test("operational review answer groups findings", () => {
    const grouped = LOGBOOK_CHUNKS.map((row) => mapMatch(row, "complaints"));
    const route = routeAskNacIntent("What should management know from uploaded logbooks?");
    const answer = buildVaultOperationalReviewAnswer(
      route,
      {
        groupedFindings: grouped.map((m) => ({
          date: "12 June",
          issueType: "complaint",
          severity: "medium",
          actionTaken: "Noted",
          excerpt: m.excerpt,
          source: m.citation,
          fileTitle: m.fileTitle,
          relevanceScore: 50,
        })),
        reviewTheme: "management",
      },
      { status: READINESS.READY },
    );
    expect(answer.directAnswer).toMatch(/Answer:/);
    expect(answer.directAnswer).toMatch(/Management note:/);
  });
});

describe("sales performance intelligence benchmarks", () => {
  const facts = [
    { metricKey: "net_sales", metricValue: 35912.17 },
    { metricKey: "guest_count", metricValue: 444 },
    { metricKey: "avg_per_guest", metricValue: 80.88 },
    { metricKey: "target_sales", metricValue: 42000 },
  ];

  test("summarize latest cash up routes to cash_up_summary", () => {
    const route = routeAskNacIntent("Summarize latest cash up");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  });

  test("cash variance query routes to cash_up_summary", () => {
    const route = routeAskNacIntent("What was the cash variance?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  });

  test("executive summary includes revenue, guests, and budget", () => {
    const summary = buildSalesPerformanceExecutiveSummary(facts, {
      branchLabel: "Khobar",
      periodLabel: "5 June 2026",
      fileTitle: "Khobar Sales 05-06-2026.xlsx",
    });
    expect(summary.answer).toMatch(/35,912.17/);
    expect(summary.answer).toMatch(/444 guests/);
    expect(summary.managementNote).toMatch(/Budget|Payment|daypart|revenue/i);
    expect(summary.answer).not.toMatch(/cash variance/i);
  });

  test("buildVaultCashUpAnswer returns sales performance manager format", () => {
    const route = routeAskNacIntent("What should management know from June performance?");
    const answer = buildVaultCashUpAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "5 June 2026",
        facts,
        vaultSources: [{ title: "Khobar Sales 05-06-2026.xlsx" }],
      },
      { status: READINESS.READY },
    );
    expect(answer.directAnswer).toMatch(/35,912.17/);
    expect(typeof answer.directAnswer).toBe("string");
    expect(answer.title).toMatch(/Sales performance/);
  });

  test("sales performance searchable text produces chunks", () => {
    const matrix = [["Net Sales", 35912.17], ["Guest Count", 444]];
    const text = buildSalesPerformanceSearchableText(matrix, { branchId: "khobar" });
    expect(text).toMatch(/Net Sales: 35912.17/);
    expect(text).toMatch(/Sales performance report/i);
    const chunks = buildSalesPerformanceSearchableChunks(
      createIntermediate({ fileType: "xlsx", matrix, text }),
      { reportType: "cash_up", branchId: "khobar" },
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkText).toMatch(/Sales performance report/i);
  });
});

describe("document management junk detection", () => {
  test("detects verify and ck1 junk filenames", () => {
    expect(isVaultJunkFilename("verify-test.txt")).toBe(true);
    expect(isVaultJunkFilename("verify-upload.csv")).toBe(true);
    expect(isVaultJunkFilename("ck1-prod-sample.txt")).toBe(true);
    expect(isVaultJunkFilename("p.txt")).toBe(true);
    expect(isVaultJunkFilename("13_June_NAC_Khobar_Logbook.docx.pdf")).toBe(false);
  });
});
