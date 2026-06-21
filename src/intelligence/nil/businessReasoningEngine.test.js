import {
  businessReasoningEngine,
  EVIDENCE_LEVELS,
  formatNilReasoningText,
  listNilDomains,
  nilReasoningToAskNacFields,
  normalizeSignalBundle,
  registerNilDomain,
  registerNilSignalAdapter,
  scoreStatementConfidence,
} from "./index";

describe("NIL domain registry", () => {
  test("registers nine intelligence domains", () => {
    const domains = listNilDomains({ includeDisabled: true });
    expect(domains.length).toBe(9);
    expect(domains.find((d) => d.id === "weather")?.bundleKey).toBe("weatherSignals");
    expect(domains.find((d) => d.id === "labor")?.enabled).toBe(false);
  });

  test("allows plug-in domain registration", () => {
    registerNilDomain({
      id: "custom_competitor_feed",
      label: "Custom competitor feed",
      bundleKey: "competitorSignals",
      defaultReliability: 0.7,
      diagnosticQuestions: ["Any new signal?"],
    });
    expect(listNilDomains({ includeDisabled: true }).some((d) => d.id === "custom_competitor_feed")).toBe(true);
  });
});

describe("NIL confidence scoring", () => {
  test("scores higher with more reliable multi-source evidence", () => {
    const low = scoreStatementConfidence({ sources: [{ name: "Observation", reliability: 0.4 }] });
    const high = scoreStatementConfidence({
      sources: [
        { name: "Cash-up facts", reliability: 0.92 },
        { name: "Daily logbook", reliability: 0.85 },
        { name: "Reception report", reliability: 0.8 },
      ],
      agreementCount: 2,
      historicalConsistency: 0.75,
    });
    expect(low.confidence).toBe("low");
    expect(high.confidence).toBe("high");
  });
});

describe("businessReasoningEngine", () => {
  const salesDeclineInput = {
    question: "Why were sales down yesterday?",
    branchLabel: "Khobar",
    periodLabel: "18 June 2026",
    internalSignals: [
      { metric: "sales_change_pct", value: -13.8 },
      { metric: "guest_change_pct", value: -12.1 },
      { metric: "avg_spend_change_pct", value: 0, stable: true },
      { metric: "delivery_performance", value: "stable", stable: true },
      { metric: "complaints_change", value: "none", stable: true },
    ],
    weatherSignals: [
      {
        label: "Humidity averaged 76%",
        value: 76,
        unit: "%",
        metadata: { historicalPattern: true, historicalConsistency: 0.6 },
      },
    ],
    competitorSignals: [
      {
        observation: "House of Agapi and Urth appeared busier than normal based on observed traffic reports",
        source: "Manager traffic report",
        reliability: 0.55,
      },
    ],
    locationSignals: [
      {
        event: "Patio Mall hosted football viewing activity",
        source: "Mall operations note",
      },
    ],
  };

  test("separates facts, correlations, hypotheses, and recommendations", () => {
    const result = businessReasoningEngine(salesDeclineInput);

    expect(result.facts.length).toBeGreaterThanOrEqual(4);
    expect(result.correlations.length).toBeGreaterThanOrEqual(2);
    expect(result.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(["low", "medium", "high"]).toContain(result.confidence);

    expect(result.facts.every((f) => f.level === EVIDENCE_LEVELS.FACT)).toBe(true);
    expect(result.hypotheses.every((h) => h.level === EVIDENCE_LEVELS.HYPOTHESIS)).toBe(true);
    expect(result.hypotheses.every((h) => !/because/i.test(h.text) || /may|likely/i.test(h.text))).toBe(true);
  });

  test("never states hypotheses as confirmed facts", () => {
    const result = businessReasoningEngine(salesDeclineInput);
    const factText = result.facts.map((f) => f.text).join(" ");
    expect(factText).toMatch(/Sales change declined/i);
    expect(factText).toMatch(/Guest count change declined/i);
    expect(factText).not.toMatch(/because humidity/i);
  });

  test("formats narrative with evidence separation", () => {
    const result = businessReasoningEngine(salesDeclineInput);
    const text = formatNilReasoningText(result);

    expect(text).toMatch(/Confirmed Facts/);
    expect(text).toMatch(/Evidence-Based Correlations/);
    expect(text).toMatch(/Hypotheses/);
    expect(text).toMatch(/Recommendations/);
    expect(text).toMatch(/Confidence/);
  });

  test("maps to Ask NAC response fields without mixing levels", () => {
    const result = businessReasoningEngine(salesDeclineInput);
    const fields = nilReasoningToAskNacFields(result);

    expect(fields.directAnswer).toMatch(/Confirmed Facts/);
    expect(fields.insights.length).toBe(result.hypotheses.length);
    expect(fields.recommendations.length).toBe(result.recommendations.length);
    expect(fields.sources.length).toBeGreaterThan(0);
  });

  test("supports plug-in signal adapter", () => {
    registerNilSignalAdapter("weather", (raw) => ({
      id: "custom-weather",
      domain: "weather",
      type: "metric",
      label: raw.customLabel,
      value: raw.customValue,
      unit: "C",
      direction: "up",
      sources: [{ name: "Custom weather feed", reliability: 0.8 }],
      reliability: 0.8,
      evidenceLevel: EVIDENCE_LEVELS.CORRELATION,
      metadata: {},
    }));

    const signals = normalizeSignalBundle({
      weatherSignals: [{ customLabel: "Heat index elevated", customValue: 41 }],
    });

    expect(signals.some((s) => s.label === "Heat index elevated")).toBe(true);
  });

  test("returns low confidence when only sparse external signals exist", () => {
    const result = businessReasoningEngine({
      competitorSignals: [{ observation: "Possible promotion nearby", reliability: 0.4 }],
    });
    expect(result.facts.length).toBe(0);
    expect(result.confidence).toBe("low");
  });
});
