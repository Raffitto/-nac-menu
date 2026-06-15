import {
  createEmptyConversationContext,
  resetConversationContext,
  updateConversationContext,
} from "./conversationContext";
import { resolveFollowUpQuestion, isFollowUpFragment } from "./resolveFollowUpQuestion";
import { prepareAskNacQuestion } from "./prepareAskNacQuestion";
import { buildSpecificMissingDataMessage } from "./missingDataMessages";
import { routeAskNacIntent, ASK_NAC_INTENTS, parseAskNacPeriod } from "../intentRouter";
import { buildDeterministicAskNacAnswer } from "../answerBuilder";
import { assessIntentReadinessSync, READINESS } from "../readinessEngine";
import { MONTH_HOURS } from "../../../dashboard/utils/rangeState";

describe("conversationContext", () => {
  test("creates empty session context", () => {
    const ctx = createEmptyConversationContext();
    expect(ctx.lastQuestion).toBeNull();
    expect(ctx.lastIntent).toBeNull();
  });

  test("updates context after a response", () => {
    const next = updateConversationContext(createEmptyConversationContext(), {
      question: "Who drove the most Google redirects?",
      resolvedQuestion: "Who drove the most Google redirects last month?",
      response: {
        intent: ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
        directAnswer: "Ali leads with 12 redirects.",
        periodLabel: "Last month",
        branchLabel: "Khobar",
      },
    });
    expect(next.lastQuestion).toBe("Who drove the most Google redirects?");
    expect(next.lastResolvedQuestion).toBe("Who drove the most Google redirects last month?");
    expect(next.lastIntent).toBe(ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD);
  });

  test("reset clears session memory", () => {
    const ctx = updateConversationContext(createEmptyConversationContext(), {
      question: "test",
      resolvedQuestion: "test",
      response: { intent: "menu_qr_scans", directAnswer: "42" },
    });
    const reset = resetConversationContext();
    expect(reset.lastQuestion).toBeNull();
    expect(ctx.lastQuestion).toBe("test");
  });
});

describe("resolveFollowUpQuestion", () => {
  const redirectContext = {
    lastQuestion: "Who drove the most Google redirects?",
    lastResolvedQuestion: "Who drove the most Google redirects?",
    lastIntent: ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD,
  };

  test("resolves period follow-up: I mean last month", () => {
    const result = resolveFollowUpQuestion("I mean last month.", redirectContext);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toBe("Who drove the most Google redirects last month?");
  });

  test("resolves branch follow-up after sales question", () => {
    const ctx = {
      lastResolvedQuestion: "What were sales in May?",
      lastIntent: ASK_NAC_INTENTS.SALES_TOTAL,
    };
    const result = resolveFollowUpQuestion("What about Riyadh?", ctx);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toBe("What were sales in May for Riyadh?");
  });

  test("resolves category entity follow-up for top items", () => {
    const ctx = {
      lastResolvedQuestion: "Which category generated the most revenue?",
      lastIntent: ASK_NAC_INTENTS.CATEGORY_SALES,
      lastEntity: "Food",
    };
    const result = resolveFollowUpQuestion("Show top 10 items.", ctx);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toBe("Show top 10 items in the Food category?");
  });

  test("resolves QR scan temporal follow-up", () => {
    const ctx = {
      lastResolvedQuestion: "How many QR scans today?",
      lastIntent: ASK_NAC_INTENTS.MENU_QR_SCANS,
    };
    const result = resolveFollowUpQuestion("And yesterday?", ctx);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toBe("How many QR scans yesterday?");
  });

  test("resolves vault coverage summarize follow-up", () => {
    const ctx = {
      lastResolvedQuestion: "Which uploaded files cover June?",
      lastIntent: ASK_NAC_INTENTS.VAULT_COVERAGE_LIST,
      lastEntity: "June",
    };
    const result = resolveFollowUpQuestion("Summarize them.", ctx);
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toBe("Summarize uploaded files covering June?");
  });

  test("does not treat standalone questions as follow-ups", () => {
    expect(isFollowUpFragment("How many menu QR scans today?", {})).toBe(false);
    const result = resolveFollowUpQuestion("How many menu QR scans today?", redirectContext);
    expect(result.usedContext).toBe(false);
    expect(result.resolvedQuestion).toBe("How many menu QR scans today?");
  });

  test("resolves document summary follow-up using active document context", () => {
    const ctx = {
      lastDocumentContext: {
        fileIds: ["file-1"],
        fileTitles: ["14 June NAC Khobar Logbook.docx.pdf"],
      },
    };
    for (const question of ["Summarize this document", "Provide an executive summary", "Key takeaways"]) {
      const result = resolveFollowUpQuestion(question, ctx);
      expect(result.usedContext).toBe(true);
      expect(result.resolvedQuestion).toBe("Summarize 14 June NAC Khobar Logbook.docx.pdf");
    }
  });

  test("stores lastDocumentContext after document search response", () => {
    const next = updateConversationContext(createEmptyConversationContext(), {
      question: "Search company knowledge for Google Review",
      resolvedQuestion: "Search company knowledge for Google Review",
      response: {
        intent: ASK_NAC_INTENTS.VAULT_DOCUMENT_SEARCH,
        directAnswer: "Found 2 mentions",
        vaultSources: [{ fileId: "file-1", title: "14 June NAC Khobar Logbook.docx.pdf" }],
      },
    });
    expect(next.lastDocumentContext?.fileIds).toEqual(["file-1"]);
    expect(next.lastDocumentContext?.fileTitles?.[0]).toContain("Khobar Logbook");
  });
});

describe("prepareAskNacQuestion", () => {
  test("chains follow-up resolution before routing", () => {
    const prepared = prepareAskNacQuestion({
      question: "I mean last month.",
      conversationContext: {
        lastResolvedQuestion: "Who drove the most Google redirects?",
      },
      filters: { timeRangeHours: 24, selectedRange: "today" },
    });
    const route = routeAskNacIntent(prepared.effectiveQuestion, { fallbackHours: 24 });
    expect(route.intent).toBe(ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD);
    expect(route.period.rangeId).toBe("last_month");
  });
});

describe("Google redirect leaderboard routing", () => {
  test("routes Who drove the most Google redirects without staff keyword", () => {
    const route = routeAskNacIntent("Who drove the most Google redirects?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD);
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.UNKNOWN);
  });

  test("does not route staff who-questions to aggregate Google redirects intent", () => {
    const route = routeAskNacIntent("Who drove the most Google redirects?");
    expect(route.intent).not.toBe(ASK_NAC_INTENTS.GOOGLE_REDIRECTS);
  });

  test("parseAskNacPeriod handles last month and yesterday", () => {
    expect(parseAskNacPeriod("redirects last month").rangeId).toBe("last_month");
    expect(parseAskNacPeriod("redirects last month").hours).toBe(MONTH_HOURS);
    expect(parseAskNacPeriod("scans yesterday").rangeId).toBe("yesterday");
  });
});

describe("missing data explanations", () => {
  test("staff leaderboard missing uses specific attribution message", () => {
    const route = routeAskNacIntent("Who drove the most Google redirects last month?");
    const readiness = {
      status: READINESS.MISSING,
      canQuery: false,
      reasons: [],
      missingData: [],
    };
    const message = buildSpecificMissingDataMessage(route, readiness);
    expect(message).toMatch(/No staff-attributed Google redirect data/i);
  });

  test("unknown intent uses guided message instead of generic unavailable", () => {
    const route = routeAskNacIntent("tell me a joke");
    expect(route.intent).toBe(ASK_NAC_INTENTS.UNKNOWN);
    const answer = buildDeterministicAskNacAnswer(route, null, {
      status: READINESS.MISSING,
      canQuery: false,
      reasons: ["Could not map this question to a supported metric intent."],
      missingData: [],
    });
    expect(answer.answerType).toBe("unknown");
    expect(answer.directAnswer).toMatch(/Try asking about menu QR scans/i);
  });

  test("blocked branch comparison explains authorization", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.BRANCH_COMPARISON, {
      profile: { authenticated: true, allBranches: false, branchScope: "khobar" },
      supabaseConfigured: true,
    });
    const route = routeAskNacIntent("Compare branches this month");
    const answer = buildDeterministicAskNacAnswer(route, null, readiness);
    expect(answer.answerType).toBe("error");
    expect(answer.directAnswer).toMatch(/branch/i);
  });
});

describe("staff leaderboard empty tool response", () => {
  test("uses specific no-attribution copy", () => {
    const route = routeAskNacIntent("Who drove the most Google redirects?");
    const answer = buildDeterministicAskNacAnswer(
      route,
      {
        leaderboard: [],
        periodLabel: "Today",
        branchLabel: "Khobar",
        sources: [],
        warnings: [],
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.directAnswer).toMatch(/No staff-attributed Google redirect data was found/i);
  });
});
