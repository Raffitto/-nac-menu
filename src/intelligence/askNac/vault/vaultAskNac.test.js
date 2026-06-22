import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { assessIntentReadinessSync, READINESS } from "../readinessEngine";
import { buildVaultAnswer } from "./vaultAnswerBuilder";
import { collectVaultSources } from "./vaultQueryTools";

const KHOBAR_DAY = {
  startDate: "2026-06-05",
  endDate: "2026-06-05",
  label: "5 June 2026",
  isSingleDay: true,
};

function mockFact({
  metricKey,
  metricValue,
  reportType,
  fileTitle,
  confidence = 0.9,
  fileId = "file-1",
  dimensions = {},
}) {
  return {
    id: `${metricKey}-${reportType}`,
    fileId,
    reportType,
    metricKey,
    metricValue,
    dimensions,
    fileTitle,
    fileConfidence: confidence,
  };
}

const CASH_UP_FACTS = [
  mockFact({ metricKey: "net_sales", metricValue: 18500, reportType: "cash_up", fileTitle: "Khobar Cash Up 05-06-2026.xlsx" }),
  mockFact({ metricKey: "guest_count", metricValue: 142, reportType: "cash_up", fileTitle: "Khobar Cash Up 05-06-2026.xlsx" }),
  mockFact({ metricKey: "order_count", metricValue: 156, reportType: "cash_up", fileTitle: "Khobar Cash Up 05-06-2026.xlsx" }),
  mockFact({ metricKey: "avg_per_guest", metricValue: 130.28, reportType: "cash_up", fileTitle: "Khobar Cash Up 05-06-2026.xlsx" }),
];

const RECEPTION_FACTS = [
  mockFact({ metricKey: "reservations", metricValue: 48, reportType: "reception_daily_report", fileTitle: "Reception 05-06-2026.pdf", fileId: "file-2" }),
  mockFact({ metricKey: "covers", metricValue: 132, reportType: "reception_daily_report", fileTitle: "Reception 05-06-2026.pdf", fileId: "file-2" }),
  mockFact({ metricKey: "walkins", metricValue: 18, reportType: "daily_logbook", fileTitle: "Logbook 05-06-2026.docx", fileId: "file-3" }),
  mockFact({ metricKey: "no_shows", metricValue: 3, reportType: "daily_logbook", fileTitle: "Logbook 05-06-2026.docx", fileId: "file-3" }),
  mockFact({ metricKey: "cancellations", metricValue: 2, reportType: "daily_logbook", fileTitle: "Logbook 05-06-2026.docx", fileId: "file-3" }),
];

const LOGBOOK_FACTS = [
  mockFact({ metricKey: "google_review_5", metricValue: 7, reportType: "daily_logbook", fileTitle: "Logbook 05-06-2026.docx", fileId: "file-3" }),
  mockFact({
    metricKey: "complaints",
    metricValue: null,
    reportType: "daily_logbook",
    fileTitle: "Logbook 05-06-2026.docx",
    fileId: "file-3",
    dimensions: { text_value: "One slow service complaint at dinner." },
  }),
];

describe("vaultPeriodParser", () => {
  test("parses 5 June with year inference", () => {
    const period = parseVaultPeriodFromQuestion("What happened in Khobar on 5 June?", new Date("2026-06-06"));
    expect(period?.startDate).toBe("2026-06-05");
    expect(period?.isSingleDay).toBe(true);
  });

  test("parses DD/MM/YYYY", () => {
    const period = parseVaultPeriodFromQuestion("Sales on 05/06/2026");
    expect(period?.startDate).toBe("2026-06-05");
  });

  test("parses month coverage June", () => {
    const period = parseVaultPeriodFromQuestion("Which uploaded files cover June?", new Date("2026-06-06"));
    expect(period?.startDate).toBe("2026-06-01");
    expect(period?.endDate).toBe("2026-06-30");
    expect(period?.isMonth).toBe(true);
  });
});

describe("vault intentRouter", () => {
  test("routes operational day summary", () => {
    const route = routeAskNacIntent("What happened in Khobar on 5 June?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY);
    expect(route.vaultPeriod?.startDate).toBe("2026-06-05");
  });

  test("routes cash-up sales on specific day", () => {
    const route = routeAskNacIntent("What were sales on 5 June?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  });

  test("routes management report", () => {
    const route = routeAskNacIntent("Generate management report for Khobar on 5 June.");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_MANAGEMENT_REPORT);
  });

  test("routes coverage list for June", () => {
    const route = routeAskNacIntent("Which uploaded files cover June?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_COVERAGE_LIST);
  });

  test("routes google 5-star on date", () => {
    const route = routeAskNacIntent("How many 5-star reviews did Khobar get on 5 June?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_GOOGLE_REVIEW_STAR_SUMMARY);
  });

  test("routes vault document search for mentions", () => {
    const route = routeAskNacIntent("Find mentions of terrace AC");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
  });

  test("routes dated logbook summary to document summary, not sales", () => {
    const route = routeAskNacIntent("Summarize the 17 June NAC Khobar logbook.");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SUMMARY);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.SALES_TOTAL);
  });

  test("routes dated logbook maintenance entries to document search", () => {
    const route = routeAskNacIntent("Show maintenance entries from the 17 June NAC Khobar logbook.");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.SALES_TOTAL);
  });

  test("routes dated what-happened branch question to vault, not sales", () => {
    const route = routeAskNacIntent("What happened on 17 June in Khobar?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.SALES_TOTAL);
  });

  test("routes sales yesterday to vault cash-up (net sales single day)", () => {
    const route = routeAskNacIntent("Sales yesterday");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultPeriod?.isSingleDay).toBe(true);
  });

  test("routes relative cash-up to vault cash-up source", () => {
    const route = routeAskNacIntent("Cash up yesterday");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultPeriod?.isSingleDay).toBe(true);
  });

  test.each([
    "show latest cash up",
    "latest cash-up report",
    "summarize latest cash up report",
    "net sales from cash up",
    "gross sales from cash up",
    "show cash up for 17 June",
    "compare cash up vs foodics",
    "search company knowledge for cash up",
  ])("routes explicit cash-up prompt to vault cash-up: %s", (question) => {
    const route = routeAskNacIntent(question);
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.SALES_TOTAL);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.FOODICS_QUERY);
  });

  test.each([
    "cash sales yesterday",
    "card sales yesterday",
    "delivery sales yesterday",
    "net sales yesterday",
    "gross sales yesterday",
  ])("routes day-specific cash-up sales metric to vault facts: %s", (question) => {
    const route = routeAskNacIntent(question);
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(route.vaultPeriod?.isSingleDay).toBe(true);
  });

  test("prefers vault over Foodics for day-specific sales", () => {
    const route = routeAskNacIntent("What were sales on 5 June?");
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.SALES_TOTAL);
  });
});

describe("vault readinessEngine", () => {
  test("requires vault period", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY, {
      supabaseConfigured: true,
    });
    expect(readiness.status).toBe(READINESS.MISSING);
    expect(readiness.canQuery).toBe(false);
  });

  test("blocks cross-branch vault query", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY, {
      supabaseConfigured: true,
      vaultPeriod: KHOBAR_DAY,
      branchMention: "riyadh",
      profile: { authenticated: true, allBranches: false, branchScope: "khobar" },
    });
    expect(readiness.status).toBe(READINESS.BLOCKED);
    expect(readiness.reasons[0]).toMatch(/scoped to Khobar/i);
  });

  test("ready when vault period parsed", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY, {
      supabaseConfigured: true,
      vaultPeriod: KHOBAR_DAY,
      branchMention: "khobar",
    });
    expect(readiness.status).toBe(READINESS.READY);
    expect(readiness.canQuery).toBe(true);
  });
});

describe("vaultAnswerBuilder", () => {
  test("cash-up answer cites source file", () => {
    const route = routeAskNacIntent("What were sales on 5 June?");
    const answer = buildVaultAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "5 June 2026",
        facts: CASH_UP_FACTS,
        vaultSources: collectVaultSources(CASH_UP_FACTS, []),
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.directAnswer).toMatch(/18,500/);
    expect(answer.vaultSources[0].title).toMatch(/Cash Up/);
    expect(answer.sources.some((s) => s.name.includes("Cash Up"))).toBe(true);
  });

  test("reception metrics from vault facts", () => {
    const route = routeAskNacIntent("How many reservations on 5 June?");
    const answer = buildVaultAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "5 June 2026",
        facts: RECEPTION_FACTS,
        vaultSources: collectVaultSources(RECEPTION_FACTS, []),
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.keyMetrics.some((m) => m.label === "Reservations" && m.value === "48")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "Walk-ins")).toBe(true);
  });

  test("logbook includes text notes", () => {
    const route = routeAskNacIntent("Logbook complaints on 5 June");
    const answer = buildVaultAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "5 June 2026",
        facts: LOGBOOK_FACTS,
        vaultSources: collectVaultSources(LOGBOOK_FACTS, []),
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.insights.some((line) => /complaint/i.test(line))).toBe(true);
  });

  test("operational day combines uploaded sections without inventing values", () => {
    const route = routeAskNacIntent("What happened in Khobar on 5 June?");
    const allFacts = [...CASH_UP_FACTS, ...RECEPTION_FACTS, ...LOGBOOK_FACTS];
    const answer = buildVaultAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "5 June 2026",
        facts: allFacts,
        byReport: {
          cash_up: CASH_UP_FACTS,
          reception_daily_report: RECEPTION_FACTS.filter((f) => f.reportType === "reception_daily_report"),
          daily_logbook: [...RECEPTION_FACTS.filter((f) => f.reportType === "daily_logbook"), ...LOGBOOK_FACTS],
        },
        vaultSources: collectVaultSources(allFacts, []),
      },
      { status: READINESS.PARTIAL, canQuery: true, reasons: ["Missing vault report types: ccm_reconciliation"] },
    );
    expect(answer.keyMetrics.some((m) => m.label === "Net sales")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "5-star Google reviews")).toBe(true);
    expect(answer.keyMetrics.some((m) => m.label === "CCM expected")).toBe(false);
    expect(answer.warnings.some((w) => /ccm_reconciliation/i.test(w))).toBe(true);
    expect(answer.vaultSources.length).toBeGreaterThan(0);
  });

  test("partial low confidence warning", () => {
    const lowFacts = CASH_UP_FACTS.map((f) => ({ ...f, fileConfidence: 0.4 }));
    const route = routeAskNacIntent("What were sales on 5 June?");
    const answer = buildVaultAnswer(
      route,
      {
        branchLabel: "Khobar",
        periodLabel: "5 June 2026",
        facts: lowFacts,
        vaultSources: collectVaultSources(lowFacts, []),
        warnings: ["Some source files have low parser confidence — treat numbers as provisional."],
      },
      { status: READINESS.PARTIAL, canQuery: true, warnings: ["Low parser confidence on some vault files."] },
    );
    expect(answer.confidence).toBe("medium");
    expect(answer.warnings.length).toBeGreaterThan(0);
  });

  test("missing-data response when no facts", () => {
    const route = routeAskNacIntent("What were sales on 5 June?");
    const answer = buildVaultAnswer(
      route,
      { branchLabel: "Khobar", periodLabel: "5 June 2026", facts: [], vaultSources: [] },
      {
        status: READINESS.MISSING,
        canQuery: false,
        reasons: ["No Data Vault coverage for cash_up on 5 June 2026 for Khobar."],
        missingData: [{ label: "Vault cash_up" }],
      },
    );
    expect(answer.answerType).toBe("missing_data");
    expect(answer.keyMetrics).toHaveLength(0);
  });
});
