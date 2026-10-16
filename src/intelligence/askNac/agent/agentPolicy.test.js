const {
  AGENT_LIMITS,
  AGENT_TOOL_CATALOG,
  authorizeToolCall,
  boundConversationContext,
  buildGreetingAnswer,
  buildWeekdayComparisonText,
  completenessGaps,
  composeDeliveryCountAndRevenue,
  contextIsNotFinancialEvidence,
  deliveryAverageOrderValue,
  isGreetingOnly,
  isSameWeekdayBackQuestion,
  questionWantsDeliveryCountAndTotal,
  resolveAnchorDate,
  sameWeekdaySeries,
  shouldInvestigateWithAgent,
  untilDateFromQuestion,
  verifyAnswerAgainstEvidence,
} = require("./agentPolicy");

describe("Ask NAC agent policy", () => {
  test("Hi is a greeting and not a sales report", () => {
    expect(isGreetingOnly("Hi")).toBe(true);
    expect(isGreetingOnly("Hi, what were sales?")).toBe(false);
    const greeting = buildGreetingAnswer();
    expect(greeting.directAnswer.toLowerCase()).toMatch(/hello/);
    expect(greeting.directAnswer).not.toMatch(/SAR|orders|sales were/i);
    expect(greeting.keyMetrics).toEqual([]);
  });

  test("Khobar October delivery count and revenue stay on the unscoped totals", () => {
    expect(questionWantsDeliveryCountAndTotal(
      "How many deliveries were done this month and how much total?",
    )).toBe(true);
    expect(deliveryAverageOrderValue(76, 9641)).toBe(126.86);
    const answer = composeDeliveryCountAndRevenue({
      branchLabel: "Khobar",
      periodLabel: "1–15 October 2026",
      orders: 76,
      sales: 9641,
      coverageStart: "2026-10-01",
      coverageEnd: "2026-10-15",
      platforms: {
        jahez: { orders: 15, sales: 1922 },
        chefz: { orders: 3, sales: 486 },
        keeta: { orders: 10, sales: 995 },
        hunger: { orders: 48, sales: 6238 },
      },
    });
    expect(answer.text).toMatch(/76 delivery orders/);
    expect(answer.text).toMatch(/SAR 9,641 delivery revenue/);
    expect(answer.text).toMatch(/SAR 126\.86/);
    expect(answer.text).toMatch(/Hunger 48 orders, SAR 6,238/);
    expect(answer.complete).toBe(true);
    expect(answer.evidenceNumbers.slice(0, 3)).toEqual([76, 9641, 126.86]);
    expect(answer.evidenceNumbers).toEqual(expect.arrayContaining([15, 1922, 48, 6238]));
  });

  test("same weekday series from 15 October reaches 6 August and stops before July", () => {
    const question = "Compare that with the same day the week before, and the week before that, until the start of August.";
    expect(isSameWeekdayBackQuestion(question)).toBe(true);
    expect(isSameWeekdayBackQuestion("Compare that with every Thursday back to the beginning of August.")).toBe(true);
    const anchor = resolveAnchorDate({
      activeState: { period: { startDate: "2026-10-15", endDate: "2026-10-15" } },
    });
    expect(anchor).toBe("2026-10-15");
    const until = untilDateFromQuestion(question, anchor);
    expect(until).toBe("2026-08-01");
    expect(sameWeekdaySeries(anchor, until)).toEqual([
      "2026-10-15",
      "2026-10-08",
      "2026-10-01",
      "2026-09-24",
      "2026-09-17",
      "2026-09-10",
      "2026-09-03",
      "2026-08-27",
      "2026-08-20",
      "2026-08-13",
      "2026-08-06",
    ]);
  });

  test("a missing weekday is stated and is not labeled complete", () => {
    const result = buildWeekdayComparisonText({
      branchLabel: "Khobar",
      metricLabel: "delivery",
      dates: ["2026-10-15", "2026-10-08"],
      rowsByDate: {
        "2026-10-15": { orders: 4, sales: 500 },
      },
    });
    expect(result.missing).toEqual(["2026-10-08"]);
    expect(result.complete).toBe(false);
    expect(result.text).toMatch(/not published/);
    expect(result.text).toMatch(/not reused as a figure/);
  });

  test("invented figures fail verification and unauthorized branches are refused", () => {
    const evidence = [76, 9641, 126.86];
    expect(verifyAnswerAgainstEvidence(
      "Khobar had 76 delivery orders and SAR 9,641 revenue, SAR 126.86 average, for 2026-10-15.",
      evidence,
    ).ok).toBe(true);
    const invented = verifyAnswerAgainstEvidence(
      "Khobar had 100 delivery orders and SAR 9,641 revenue.",
      evidence,
    );
    expect(invented.ok).toBe(false);
    expect(invented.invented).toContain(100);

    expect(authorizeToolCall({
      tool: "delivery_summary",
      args: { branch: "riyadh", startDate: "2026-10-01", endDate: "2026-10-15" },
      allowedBranchIds: ["khobar"],
      allBranches: false,
    }).error).toBe("branch_denied");
    expect(authorizeToolCall({
      tool: "drop_table",
      args: {},
    }).error).toBe("tool_not_allowed");
    expect(authorizeToolCall({
      tool: "cash_up_summary",
      args: { branch: "khobar", startDate: "2026-10-01", endDate: "2026-10-15" },
      allowedBranchIds: ["khobar"],
    }).ok).toBe(true);
  });

  test("persisted context keeps the anchor and drops prior figures", () => {
    const bounded = boundConversationContext({
      lastQuestion: "What were Khobar deliveries on 15 October?",
      lastAnswerSummary: "SAR 9,641 and 76 orders",
      lastDataset: { dailyBreakdown: [{ date: "2026-10-15", totalSales: 13842 }] },
      lastBranch: "Khobar",
      lastMetric: "delivery",
      activeState: { period: { startDate: "2026-10-15", endDate: "2026-10-15" } },
    });
    expect(bounded.anchorDate).toBe("2026-10-15");
    expect(bounded.lastAnswerSummary).toBeUndefined();
    expect(bounded.lastDataset).toBeUndefined();
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(AGENT_LIMITS.contextMaxChars);
    expect(contextIsNotFinancialEvidence({
      lastAnswerSummary: "76",
      activeState: { period: { startDate: "2026-10-15", endDate: "2026-10-15" } },
    })).toBe(true);
  });

  test("the registry covers the operational sources and rejects SQL", () => {
    const names = AGENT_TOOL_CATALOG.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "cash_up_summary",
      "delivery_summary",
      "logbook_summary",
      "menu_performance",
      "google_reviews",
      "knowledge_search",
      "uploaded_product_sales",
      "operational_day",
      "branch_compare",
    ]));
    expect(authorizeToolCall({ tool: "select * from ask_nac_structured_facts", args: {} }).error).toBe("tool_not_allowed");
    expect(authorizeToolCall({
      tool: "branch_compare",
      args: { branches: ["khobar", "riyadh"], startDate: "2026-10-01", endDate: "2026-10-15" },
      allowedBranchIds: ["khobar"],
    }).error).toBe("branch_denied");
    expect(authorizeToolCall({
      tool: "menu_performance",
      args: { branch: "khobar", hours: 10000 },
      allowedBranchIds: ["khobar"],
    }).error).toBe("invalid_hours");
  });

  test("an answer is incomplete when it drops half the question or explains nothing", () => {
    expect(completenessGaps(
      "How many deliveries and how much revenue?",
      "Delivery revenue was SAR 9,641.",
      ["delivery_summary"],
    )).toContain("orders");
    expect(completenessGaps(
      "Why did sales decrease?",
      "Sales were SAR 9,641.",
      ["cash_up_summary"],
    )).toContain("cause");
    expect(completenessGaps(
      "Why did sales decrease?",
      "Sales were SAR 9,641. I cannot explain the change because the logbook is not published.",
      ["cash_up_summary", "logbook_summary"],
    )).toEqual([]);
    expect(shouldInvestigateWithAgent("Why did Khobar sales decrease?", "vault_cash_up_summary")).toBe(true);
    expect(shouldInvestigateWithAgent("Hi", "unknown")).toBe(false);
    expect(shouldInvestigateWithAgent("Which dishes should we promote?", "unknown")).toBe(true);
    expect(shouldInvestigateWithAgent("What happened yesterday?", "unknown")).toBe(true);
  });
});
