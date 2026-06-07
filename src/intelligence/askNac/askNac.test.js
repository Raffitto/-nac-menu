import {
  routeAskNacIntent,
  ASK_NAC_INTENTS,
  parseAskNacPeriod,
} from "./intentRouter";
import { assessIntentReadinessSync, READINESS } from "./readinessEngine";
import { buildDeterministicAskNacAnswer } from "./answerBuilder";
import { MONTH_HOURS } from "../../dashboard/utils/rangeState";

describe("askNac intentRouter", () => {
  test("routes menu QR scans", () => {
    const route = routeAskNacIntent("How many menu QR scans today?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.MENU_QR_SCANS);
    expect(route.period.hours).toBe(24);
  });

  test("routes Google redirects", () => {
    const route = routeAskNacIntent("Google redirects this month");
    expect(route.intent).toBe(ASK_NAC_INTENTS.GOOGLE_REDIRECTS);
    expect(route.period.hours).toBe(MONTH_HOURS);
  });

  test("routes staff leaderboard", () => {
    const route = routeAskNacIntent("Which staff drove the most Google redirects?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD);
  });

  test("routes branch comparison", () => {
    const route = routeAskNacIntent("Compare branches this month");
    expect(route.intent).toBe(ASK_NAC_INTENTS.BRANCH_COMPARISON);
  });

  test("routes missing-data avg spend", () => {
    const route = routeAskNacIntent("What is average spend per guest?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST);
  });

  test("parseAskNacPeriod respects month phrases", () => {
    expect(parseAskNacPeriod("menu scans month to date").hours).toBe(MONTH_HOURS);
  });

  test("routes Foodics sales total", () => {
    const route = routeAskNacIntent("What were sales in May?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.SALES_TOTAL);
    expect(route.foodicsPeriod?.startDate).toBe("2026-05-01");
  });

  test("routes top items last month", () => {
    const route = routeAskNacIntent("What were the top 10 items last month?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.TOP_ITEMS);
    expect(route.topLimit).toBe(10);
  });

  test("routes item rank change entered", () => {
    const route = routeAskNacIntent("Which item entered the top 10 compared to last month?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.ITEM_RANK_CHANGE);
    expect(route.rankChangeDirection).toBe("entered");
  });

  test("routes category sales", () => {
    const route = routeAskNacIntent("Which category generated the most revenue?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.CATEGORY_SALES);
  });

  test("routes quantity ranking basis", () => {
    const route = routeAskNacIntent("Rank items by quantity instead of sales.");
    expect(route.rankingBasis).toBe("quantity");
  });

  test("routes vault operational day for Khobar 5 June", () => {
    const route = routeAskNacIntent("What happened in Khobar on 5 June?");
    expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_OPERATIONAL_DAY_SUMMARY);
    expect(route.vaultPeriod?.startDate).toBe("2026-06-05");
    expect(route.branchMention).toBe("khobar");
  });
});

describe("askNac readinessEngine", () => {
  test("blocks branch comparison for branch-scoped profile", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.BRANCH_COMPARISON, {
      profile: { authenticated: true, allBranches: false, branchScope: "khobar" },
      supabaseConfigured: true,
    });
    expect(readiness.status).toBe(READINESS.BLOCKED);
    expect(readiness.canQuery).toBe(false);
  });

  test("marks avg spend as missing", () => {
    const readiness = assessIntentReadinessSync(ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST, {
      supabaseConfigured: true,
    });
    expect(readiness.status).toBe(READINESS.MISSING);
    expect(readiness.missingData.length).toBeGreaterThan(0);
  });
});

describe("askNac answerBuilder", () => {
  test("builds menu QR metric answer from tool facts", () => {
    const route = routeAskNacIntent("menu QR scans today");
    const answer = buildDeterministicAskNacAnswer(
      route,
      {
        menuQrScans: 42,
        menuSessions: 42,
        periodLabel: "Today",
        branchLabel: "Khobar",
        dataSource: "hybrid",
        mtdHybrid: { source: "hybrid", includesCurrentBusinessDay: true, partialLive: false, warnings: [] },
        sources: [{ name: "fetchAskNacMenuMetrics", detail: "hybrid" }],
        warnings: [],
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.directAnswer).toMatch(/42/);
    expect(answer.keyMetrics[0].value).toBe(42);
    expect(answer.isAiGenerated).toBe(false);
    expect(answer.diagnostics).toEqual({ source: "hybrid", includesCurrentBusinessDay: true, partialLive: false, warnings: [] });
  });

  test("returns missing-data response without fabricating numbers", () => {
    const route = routeAskNacIntent("delivery platform sales");
    const readiness = assessIntentReadinessSync(route.intent, { supabaseConfigured: true });
    const answer = buildDeterministicAskNacAnswer(route, null, readiness);
    expect(answer.answerType).toBe("missing_data");
    expect(answer.keyMetrics).toHaveLength(0);
  });

  test("builds Foodics sales answer with batch coverage", () => {
    const route = routeAskNacIntent("What were sales in May?");
    const answer = buildDeterministicAskNacAnswer(
      route,
      {
        totals: { netSales: 12000, grossSales: 13000, quantity: 400 },
        periodLabel: "May 2026",
        branchLabel: "Khobar",
        batchCoverage: "Foodics import may.xlsx · 2026-05-01 to 2026-05-31 · Khobar",
        sources: [{ name: "foodics_sales_items", detail: "batch" }],
        warnings: [],
      },
      { status: READINESS.READY, canQuery: true },
    );
    expect(answer.directAnswer).toMatch(/12,000/);
    expect(answer.keyMetrics.length).toBeGreaterThan(0);
    expect(answer.sources.length).toBeGreaterThan(0);
  });
});
