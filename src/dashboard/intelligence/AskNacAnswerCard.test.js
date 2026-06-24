import React from "react";
import { render, screen } from "@testing-library/react";
import AskNacAnswerCard from "./AskNacAnswerCard";
import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import { ASK_NAC_INTENTS } from "../../intelligence/askNac/intentRouter";

const SAMPLE_BRIEF = {
  executiveSummary: "Khobar cash-up for 2026-06-17 reports net sales of 17,941.739 SAR.",
  keyFindings: [
    "Net sales: 17,941.739 SAR",
    "Gross sales: 20,633 SAR",
    "Card sales: 19,046 SAR; cash sales: 629 SAR",
  ],
  operationalRisks: ["Coverage is partial for this period."],
  recommendedActions: ["Confirm totals against Cash up 2026.xlsx before sign-off."],
  dataSources: ["Cash up 2026.xlsx · cash_up · 2026-06-17"],
};

function buildCashUpResponse(overrides = {}) {
  return {
    answerType: ANSWER_TYPES.EXECUTIVE,
    intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
    title: "Cash-up · Khobar · 17 June 2026",
    directAnswer: "Answer:\nNet sales 17,941.739 SAR\n\nManagement note:\nReview partial coverage.",
    executiveBrief: SAMPLE_BRIEF,
    keyMetrics: [
      { key: "net_sales", label: "Net sales", value: 17941.739, unit: "SAR" },
      { key: "gross_sales", label: "Gross sales", value: 20633, unit: "SAR" },
      { key: "card_sales", label: "Card sales", value: 19046, unit: "SAR" },
      { key: "cash_sales", label: "Cash sales", value: 629, unit: "SAR" },
    ],
    insights: ["Card-heavy day with low cash share."],
    recommendations: ["Validate delivery totals against POS export."],
    sources: [{ name: "vaultCashUpFacts", detail: "Khobar · 2026-06-17" }],
    warnings: [],
    missingData: [],
    confidence: "high",
    exportOptions: [],
    isAiGenerated: false,
    serverConnected: true,
    localFallback: false,
    ...overrides,
  };
}

function renderCard(response, variant = "desktop") {
  return render(
    <AskNacAnswerCard
      variant={variant}
      question="show latest cash up"
      filters={{}}
      response={response}
    />,
  );
}

describe("AskNacAnswerCard cash-up executive brief", () => {
  test("desktop renders executiveBrief sections instead of legacy directAnswer block", () => {
    renderCard(buildCashUpResponse());

    expect(screen.getByTestId("cash-up-executive-brief")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Executive Summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Key Findings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operational Risks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recommended Actions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_BRIEF.executiveSummary)).toBeInTheDocument();
    expect(screen.getByText("Net sales: 17,941.739 SAR")).toBeInTheDocument();
    expect(screen.getByText("Coverage is partial for this period.")).toBeInTheDocument();
    expect(screen.queryByText(/Answer:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Management note:/)).not.toBeInTheDocument();
    expect(screen.getByText("Card-heavy day with low cash share.")).toBeInTheDocument();
    expect(screen.getByText("Validate delivery totals against POS export.")).toBeInTheDocument();
    expect(screen.getAllByText("Net Sales").length).toBeGreaterThan(0);
    expect(screen.getByTestId("cash-up-executive-kpis")).toBeInTheDocument();
    expect(screen.getAllByText("Electronic Payments").length).toBeGreaterThan(0);
  });

  test("hides cash-up debug panel unless developer flag is enabled", () => {
    delete process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG;
    renderCard(
      buildCashUpResponse({
        cashUpDebug: { intent: "vault_cash_up_summary", factsRowCount: 20 },
        cashUpProductionTrace: { failurePoint: null },
      }),
    );

    expect(screen.queryByTestId("cash-up-debug-panel")).not.toBeInTheDocument();
  });

  test("shows expandable cash-up debug panel for developer flag", () => {
    process.env.REACT_APP_ASK_NAC_CASHUP_DEBUG = "true";
    renderCard(
      buildCashUpResponse({
        cashUpDebug: { intent: "vault_cash_up_summary", factsRowCount: 20 },
      }),
    );

    expect(screen.getByTestId("cash-up-debug-panel")).toBeInTheDocument();
    expect(screen.getByText("Cash-up debug (developer)")).toBeInTheDocument();
  });

  test("mobile renders executiveBrief sections", () => {
    renderCard(buildCashUpResponse(), "mobile");

    expect(screen.getByTestId("cash-up-executive-brief")).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_BRIEF.executiveSummary)).toBeInTheDocument();
    expect(screen.queryByText(/Answer:/)).not.toBeInTheDocument();
  });

  test("falls back to directAnswer when executiveBrief is missing", () => {
    renderCard(
      buildCashUpResponse({
        executiveBrief: null,
        directAnswer: "Answer:\nLegacy cash-up block\n\nManagement note:\nStill here",
      }),
    );

    expect(screen.queryByTestId("cash-up-executive-brief")).not.toBeInTheDocument();
    expect(screen.getByText(/Legacy cash-up block/)).toBeInTheDocument();
    expect(screen.getByText(/Management note:/)).toBeInTheDocument();
  });

  test("coerces object-shaped directAnswer to plain text in details", () => {
    renderCard(
      buildCashUpResponse({
        executiveBrief: null,
        directAnswer: { executiveSummary: "Khobar cash-up shows net sales of 17,941 SAR." },
      }),
    );

    expect(screen.getByText(/Khobar cash-up shows net sales of 17,941 SAR/)).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });

  test("renders conversation chart for visualization follow-up", () => {
    renderCard({
      answerType: ANSWER_TYPES.METRIC,
      intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
      title: "Daily breakdown · last 7 days",
      directAnswer: "Khobar daily net sales for last 7 days (5 day(s) from prior answer).",
      conversationResolution: { followUpCategory: "visualization", usedContext: true },
      conversationChart: {
        metricKey: "net_sales",
        metricLabel: "Net sales",
        unit: "SAR",
        points: [
          { date: "2026-06-18", label: "2026-06-18", value: 12000 },
          { date: "2026-06-19", label: "2026-06-19", value: 9000 },
        ],
      },
      keyMetrics: [],
      insights: [],
      recommendations: [],
      sources: [],
      warnings: [],
      missingData: [],
      confidence: "high",
      exportOptions: [],
      isAiGenerated: false,
    });

    expect(screen.getByTestId("ask-nac-conversation-chart")).toBeInTheDocument();
    expect(screen.getByText("Net sales by day")).toBeInTheDocument();
  });

  test("shows visualization fallback when dataset is missing", () => {
    renderCard({
      answerType: ANSWER_TYPES.METRIC,
      intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
      title: "Daily breakdown · last 7 days",
      directAnswer: "No daily breakdown available.",
      conversationResolution: { followUpCategory: "visualization", usedContext: true },
      conversationDataset: { dailyBreakdown: [] },
      keyMetrics: [],
      insights: [],
      recommendations: [],
      sources: [],
      warnings: [],
      missingData: [],
      confidence: "medium",
      exportOptions: [],
      isAiGenerated: false,
    });

    expect(screen.getByTestId("ask-nac-visualization-fallback")).toHaveTextContent(
      /once daily breakdown data is available/i,
    );
  });

  test("does not apply executive brief renderer to non-cash-up answers", () => {
    renderCard(
      buildCashUpResponse({
        intent: ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS,
        title: "Branch performance",
        directAnswer: "Riyadh leads network sales this month.",
      }),
    );

    expect(screen.queryByTestId("cash-up-executive-brief")).not.toBeInTheDocument();
    expect(screen.getByText("Riyadh leads network sales this month.")).toBeInTheDocument();
  });

  test("metric answers remain unchanged when executiveBrief is absent", () => {
    render(
      <AskNacAnswerCard
        variant="desktop"
        question="Menu QR scans today"
        filters={{}}
        response={{
          answerType: ANSWER_TYPES.METRIC,
          intent: ASK_NAC_INTENTS.MENU_QR_SCANS,
          title: "Menu QR Scans · Today",
          directAnswer: "42 menu QR scans for Khobar (Today).",
          keyMetrics: [{ label: "Menu QR Scans", value: 42 }],
          insights: [],
          recommendations: [],
          sources: [{ name: "fetchAskNacMenuMetrics", detail: "hybrid" }],
          warnings: [],
          missingData: [],
          confidence: "high",
          exportOptions: [],
          isAiGenerated: false,
        }}
      />,
    );

    expect(screen.queryByTestId("cash-up-executive-brief")).not.toBeInTheDocument();
    expect(screen.getByText("42 menu QR scans for Khobar (Today).")).toBeInTheDocument();
  });
});
