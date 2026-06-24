import { ASK_NAC_INTENTS } from "../intentRouter";
import { resolveFollowUpQuestion, isFollowUpFragment } from "./resolveFollowUpQuestion";
import { classifyFollowUp } from "./conversationFollowUpTaxonomy";
import { captureConversationStateFromTurn, createEmptyConversationState } from "./conversationState";
import { updateConversationContext } from "./conversationContext";

const cashUpContext = {
  lastQuestion: "Show net sales for last 7 days",
  lastResolvedQuestion: "Show net sales for last 7 days",
  lastIntent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
  lastBranch: "Khobar",
  lastPeriod: "last_7_days",
  lastMetric: "net_sales",
  activeState: {
    ...createEmptyConversationState(),
    intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
    metric: "net_sales",
    metricLabel: "net sales",
    branch: "khobar",
    branchLabel: "Khobar",
    period: { label: "last 7 days", rangeId: "last_7_days", periodType: "last_7_days" },
    resolvedQuestion: "Show net sales for last 7 days",
    dataset: {
      kind: "cash_up_aggregation",
      dailyBreakdown: [
        { date: "2026-06-14", totalSales: 12000 },
        { date: "2026-06-15", totalSales: 9000 },
        { date: "2026-06-16", totalSales: 15000 },
      ],
      aggregation: { dayCount: 3, totalSales: 36000, dailyBreakdown: [] },
    },
  },
};

describe("Conversation Intelligence V1 executive chains", () => {
  test("Chain 1 — visualize inherits metric and period", () => {
    expect(isFollowUpFragment("Visualize it", cashUpContext)).toBe(true);
    const result = resolveFollowUpQuestion("Visualize it", cashUpContext);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toMatch(/net sales/i);
    expect(result.resolvedQuestion).toMatch(/last 7 days/i);
    expect(result.followUpCategory).toBe("visualization");
    expect(result.preferDatasetReuse).toBe(true);
  });

  test("Chain 1 — break it down by day", () => {
    const result = resolveFollowUpQuestion("Break it down by day", cashUpContext);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toMatch(/by day/i);
    expect(result.resolvedQuestion).toMatch(/net sales/i);
    expect(result.followUpCategory).toBe("drill_down");
  });

  test("Chain 1 — compare to previous week", () => {
    const result = resolveFollowUpQuestion("Compare it to previous week", cashUpContext);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toMatch(/compare/i);
    expect(result.resolvedQuestion).toMatch(/previous/i);
    expect(result.followUpCategory).toBe("comparison");
  });

  test("Chain 1 — why was worst day weak expands with dataset anchor", () => {
    const result = resolveFollowUpQuestion("Why was the worst day weak?", cashUpContext);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toMatch(/2026-06-15/);
    expect(result.followUpCategory).toBe("explanation");
  });

  test("Chain 3 — branch pivot and compare both", () => {
    let ctx = updateConversationContext({}, {
      question: "Show Khobar sales for last 7 days",
      resolvedQuestion: "Show Khobar sales for last 7 days",
      response: {
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        branchLabel: "Khobar",
        periodLabel: "last 7 days",
        conversationDataset: {
          kind: "cash_up_aggregation",
          aggregation: { dayCount: 7, totalSales: 100000, dailyBreakdown: [] },
          dailyBreakdown: [],
        },
      },
    });

    const riyadh = resolveFollowUpQuestion("What about Riyadh?", ctx);
    expect(riyadh.usedContext).toBe(true);
    expect(riyadh.resolvedQuestion).toMatch(/Riyadh/i);

    ctx = updateConversationContext(ctx, {
      question: "What about Riyadh?",
      resolvedQuestion: riyadh.resolvedQuestion,
      response: {
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        branchLabel: "Riyadh",
        periodLabel: "last 7 days",
      },
    });
    expect(ctx.activeState.branchHistory).toContain("khobar");
    expect(ctx.activeState.branchHistory).toContain("riyadh");

    const compareBoth = resolveFollowUpQuestion("Compare both", ctx);
    expect(compareBoth.usedContext).toBe(true);
    expect(compareBoth.resolvedQuestion).toMatch(/Khobar/i);
    expect(compareBoth.resolvedQuestion).toMatch(/Riyadh/i);
  });

  test("captures conversation state with dataset and metric", () => {
    const state = captureConversationStateFromTurn({
      question: "Show net sales for last 7 days",
      resolvedQuestion: "Show net sales for last 7 days",
      response: {
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        branchLabel: "Khobar",
        periodLabel: "last 7 days",
        conversationDataset: {
          kind: "cash_up_aggregation",
          aggregation: { dayCount: 7, totalSales: 50000, dailyBreakdown: [{ date: "2026-06-16", totalSales: 8000 }] },
          dailyBreakdown: [{ date: "2026-06-16", totalSales: 8000 }],
        },
      },
      route: { intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY, vaultPeriod: { periodType: "last_7_days", label: "last 7 days" } },
    });
    expect(state.metric).toBe("net_sales");
    expect(state.dataset?.dailyBreakdown).toHaveLength(1);
    expect(state.branch).toBe("khobar");
  });

  test("classifyFollowUp taxonomy labels visualization", () => {
    const classified = classifyFollowUp("chart it", cashUpContext.activeState);
    expect(classified.category).toBe("visualization");
    expect(classified.confidence).toBe("known");
  });

  test("updateConversationContext stores metric not intent", () => {
    const next = updateConversationContext({}, {
      question: "Show net sales for last 7 days",
      resolvedQuestion: "Show net sales for last 7 days",
      response: {
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        directAnswer: "Khobar total sales...",
        periodLabel: "last 7 days",
        branchLabel: "Khobar",
      },
    });
    expect(next.lastMetric).toBe("net_sales");
    expect(next.lastMetric).not.toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
    expect(next.activeState.metric).toBe("net_sales");
  });
});
