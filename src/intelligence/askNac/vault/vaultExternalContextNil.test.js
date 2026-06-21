import { EXTERNAL_SIGNAL_TYPES } from "../../externalContext/externalContextContract";
import { buildVaultBusinessReasoningAnswer } from "./vaultBusinessReasoningAnswer";
import { ASK_NAC_INTENTS } from "../intentRouter";
import {
  buildExternalContextNilPayload,
  collectExternalContextSourceLabels,
  filterCompetitorObservationsForAccess,
  filterExternalContextSignalsForAccess,
  resolveNilCombinedPeriodBounds,
} from "./vaultExternalContextRetrieval";

const PERIOD = { startDate: "2026-06-14", endDate: "2026-06-20" };

const BASE_TOOL = {
  branchLabel: "Khobar",
  periodLabel: "last 7 days vs previous 7 days",
  vaultCompare: {
    current: { startDate: "2026-06-14", endDate: "2026-06-20", label: "last 7 days" },
    previous: { startDate: "2026-06-07", endDate: "2026-06-13", label: "previous 7 days" },
  },
  aggregation: {
    totalSales: 90000,
    totalGuests: 900,
    averageSpend: 100,
    totalDeliverySales: 10000,
    totalDeliveryOrders: 100,
    dayCount: 7,
  },
  previousAggregation: {
    totalSales: 100000,
    totalGuests: 1000,
    averageSpend: 100,
    totalDeliverySales: 10000,
    totalDeliveryOrders: 100,
    dayCount: 7,
  },
  sources: [],
  warnings: [],
};

const BASE_ROUTE = {
  intent: ASK_NAC_INTENTS.VAULT_BUSINESS_REASONING,
  question: "why were sales down last 7 days",
  whyMetricFocus: "sales",
};

const khobarManager = {
  hasAllBranches: false,
  hasAnyBranchAccess: true,
  branchAllowed: (b) => b === "khobar",
  canReadSensitivity: (l) => l === "public" || l === "internal",
};

describe("resolveNilCombinedPeriodBounds", () => {
  test("spans current and previous compare windows", () => {
    const bounds = resolveNilCombinedPeriodBounds(BASE_TOOL);
    expect(bounds.startDate).toBe("2026-06-07");
    expect(bounds.endDate).toBe("2026-06-20");
  });
});

describe("external context NIL plumbing", () => {
  test("no external rows preserves unavailable note and manual recommendations", () => {
    const answer = buildVaultBusinessReasoningAnswer(
      BASE_ROUTE,
      { ...BASE_TOOL, externalContext: { externalSignals: [], competitorObservations: [], competitors: [] } },
      { status: "ready", canQuery: true },
    );

    expect(answer.directAnswer).toMatch(/No external context sources are connected yet/);
    expect(answer.directAnswer).not.toMatch(/External Context Sources/);
    expect(answer.warnings).toContain("No external context sources are connected yet.");
    expect(answer.recommendations.some((r) => /competitor\/mall activity manually/i.test(r))).toBe(true);
    expect(answer.recommendations.some((r) => /weather\/local context manually/i.test(r))).toBe(true);
    expect(answer.diagnostics.externalContextConnected).toBe(false);
  });

  test("weather signal only lists source label and connects external context", () => {
    const externalContext = {
      externalSignals: [
        {
          id: "w1",
          signal_type: EXTERNAL_SIGNAL_TYPES.WEATHER,
          branch_id: "khobar",
          applies_to_all_branches: false,
          signal_date: "2026-06-18",
          title: "High humidity",
          source_name: "Weather Service",
          source_reliability: 0.8,
          confidence: "high",
        },
      ],
      competitorObservations: [],
      competitors: [],
    };

    const answer = buildVaultBusinessReasoningAnswer(
      BASE_ROUTE,
      { ...BASE_TOOL, externalContext },
      { status: "ready", canQuery: true },
    );

    expect(answer.directAnswer).toMatch(/External Context Sources/);
    expect(answer.directAnswer).toMatch(/Weather Service/);
    expect(answer.directAnswer).not.toMatch(/No external context sources are connected yet/);
    expect(answer.warnings).not.toContain("No external context sources are connected yet.");
    expect(answer.recommendations.some((r) => /weather\/local context manually/i.test(r))).toBe(false);
    expect(answer.diagnostics.externalContextConnected).toBe(true);
  });

  test("competitor observation only shows Manager Observation label", () => {
    const externalContext = {
      externalSignals: [],
      competitorObservations: [
        {
          id: "o1",
          competitor_id: "c1",
          branch_id: "khobar",
          observation_date: "2026-06-18",
          observation_text: "Busy dinner service reported nearby",
          source_type: "manager_report",
          sensitivity_level: "internal",
        },
      ],
      competitors: [{ id: "c1", name: "HOUSE OF AGAPI", branch_id: "khobar" }],
    };

    const answer = buildVaultBusinessReasoningAnswer(
      BASE_ROUTE,
      { ...BASE_TOOL, externalContext },
      { status: "ready", canQuery: true },
    );

    expect(answer.directAnswer).toMatch(/External Context Sources/);
    expect(answer.directAnswer).toMatch(/Manager Observation/);
    expect(answer.diagnostics.externalContextConnected).toBe(true);
    expect(answer.directAnswer.toLowerCase()).not.toMatch(/because competitors/);
  });

  test("mixed signals list multiple source labels", () => {
    const externalContext = {
      externalSignals: [
        {
          id: "w1",
          signal_type: EXTERNAL_SIGNAL_TYPES.WEATHER,
          branch_id: "khobar",
          applies_to_all_branches: false,
          signal_date: "2026-06-18",
          title: "Rain",
          source_name: "Weather Service",
        },
      ],
      competitorObservations: [
        {
          id: "o1",
          competitor_id: "c1",
          branch_id: "khobar",
          observation_date: "2026-06-17",
          observation_text: "Promotion signage visible",
          source_type: "manual",
          sensitivity_level: "internal",
        },
      ],
      competitors: [{ id: "c1", name: "Urth Caffé", branch_id: "khobar" }],
    };

    const labels = collectExternalContextSourceLabels(externalContext);
    expect(labels).toEqual(["Competitor Observation", "Weather Service"]);

    const payload = buildExternalContextNilPayload({
      ...externalContext,
      branchLabel: "Khobar",
      periodLabel: BASE_TOOL.periodLabel,
      period: PERIOD,
    });
    expect(payload.connected).toBe(true);
    expect(payload.nilBundle.weatherSignals.length).toBeGreaterThan(0);
    expect(payload.nilBundle.competitorSignals.length).toBeGreaterThan(0);
  });

  test("branch isolation filters external signals and observations", () => {
    const signals = [
      { id: "s1", branch_id: "khobar", applies_to_all_branches: false, signal_date: "2026-06-18" },
      { id: "s2", branch_id: "riyadh", applies_to_all_branches: false, signal_date: "2026-06-18" },
      { id: "s3", branch_id: null, applies_to_all_branches: true, signal_date: "2026-06-18" },
    ];
    const observations = [
      { id: "o1", branch_id: "khobar", observation_date: "2026-06-18", sensitivity_level: "internal" },
      { id: "o2", branch_id: "riyadh", observation_date: "2026-06-18", sensitivity_level: "internal" },
    ];

    const khobarSignals = filterExternalContextSignalsForAccess(signals, khobarManager, PERIOD);
    expect(khobarSignals.map((s) => s.id).sort()).toEqual(["s1", "s3"]);

    const khobarObs = filterCompetitorObservationsForAccess(observations, khobarManager, PERIOD);
    expect(khobarObs).toHaveLength(1);
    expect(khobarObs[0].id).toBe("o1");
  });

  test("sensitivity filtering excludes confidential observations for branch staff scope", () => {
    const observations = [
      {
        id: "o1",
        branch_id: "khobar",
        observation_date: "2026-06-18",
        sensitivity_level: "internal",
      },
      {
        id: "o2",
        branch_id: "khobar",
        observation_date: "2026-06-18",
        sensitivity_level: "confidential",
      },
    ];

    const visible = filterCompetitorObservationsForAccess(observations, khobarManager, PERIOD);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("o1");
  });
});
