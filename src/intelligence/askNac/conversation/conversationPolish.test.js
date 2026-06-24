import {
  coercePlainTextDirectAnswer,
  resolveAskNacDirectAnswer,
} from "./coercePlainTextDirectAnswer";
import {
  buildConversationChartPayload,
  resolveVisualizationPresentation,
  VISUALIZATION_FALLBACK,
} from "./conversationVisualization";

describe("coercePlainTextDirectAnswer", () => {
  test("returns string directAnswer unchanged", () => {
    expect(coercePlainTextDirectAnswer("Khobar net sales were 10,000 SAR.")).toBe(
      "Khobar net sales were 10,000 SAR.",
    );
  });

  test("coerces object directAnswer using executiveSummary", () => {
    const text = coercePlainTextDirectAnswer(
      { executiveSummary: "Khobar cash-up shows net sales of 17,941 SAR." },
      {},
    );
    expect(text).toBe("Khobar cash-up shows net sales of 17,941 SAR.");
  });

  test("falls back to executiveBrief summary for latest cash up style responses", () => {
    const text = resolveAskNacDirectAnswer({
      directAnswer: { foo: "bar" },
      executiveBrief: {
        executiveSummary: "Khobar cash-up for 2026-06-17 shows net sales of 17,941.739 SAR.",
      },
    });
    expect(text).toMatch(/net sales of 17,941/i);
    expect(text).not.toBe("[object Object]");
  });
});

describe("conversationVisualization", () => {
  const sampleResponse = {
    title: "Daily breakdown · last 7 days",
    conversationResolution: { followUpCategory: "visualization" },
    conversationDataset: {
      metric: "net_sales",
      dailyBreakdown: [
        { date: "2026-06-18", totalSales: 12000 },
        { date: "2026-06-19", totalSales: 9000 },
      ],
    },
  };

  test("visualize it with dailyBreakdown renders chart payload", () => {
    const chart = buildConversationChartPayload(sampleResponse);
    expect(chart).not.toBeNull();
    expect(chart.metricKey).toBe("net_sales");
    expect(chart.points).toHaveLength(2);
    expect(chart.points[0].value).toBe(12000);
  });

  test("visualize it without dailyBreakdown gives safe fallback", () => {
    const presentation = resolveVisualizationPresentation({
      conversationResolution: { followUpCategory: "visualization" },
      conversationDataset: { dailyBreakdown: [] },
      title: "Daily breakdown · last 7 days",
    });
    expect(presentation.chart).toBeNull();
    expect(presentation.fallback).toBe(VISUALIZATION_FALLBACK);
  });

  test("delivery metric uses delivery sales series", () => {
    const chart = buildConversationChartPayload({
      conversationResolution: { resolvedQuestion: "Show delivery sales daily breakdown" },
      conversationDataset: {
        metric: "delivery_sales",
        dailyBreakdown: [{ date: "2026-06-18", totalDeliverySales: 5000 }],
      },
    });
    expect(chart.metricKey).toBe("delivery_sales");
    expect(chart.points[0].value).toBe(5000);
  });
});
