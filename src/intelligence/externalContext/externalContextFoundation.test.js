import {
  normalizeCompetitorName,
  validateExternalContextSignalRow,
  validateCompetitorRow,
  mapSignalTypeToNilDomain,
  scoreSignalPeriodOverlap,
  containsForbiddenCausalityLanguage,
  EXTERNAL_SIGNAL_TYPES,
  KHOBAR_COMPETITOR_SEED_NAMES,
  adaptExternalContextToNilBundle,
  hasExternalContextSignals,
  mergeNilSignalBundles,
  normalizeCompetitorRecord,
  filterActiveCompetitorsForBranch,
} from "./index";

import {
  normalizePhoneE164,
  classifyWhatsAppMessage,
  resolveWhatsAppBranch,
  formatAskNacAnswerForWhatsApp,
  WHATSAPP_MESSAGE_CATEGORIES,
} from "../whatsapp";

describe("competitor normalization", () => {
  test("normalizeCompetitorName lowercases and collapses whitespace", () => {
    expect(normalizeCompetitorName("  HOUSE OF AGAPI  ")).toBe("house of agapi");
    expect(normalizeCompetitorName("Urth Caffé")).toBe("urth caffé");
  });

  test("normalizeCompetitorRecord fills normalized_name", () => {
    const row = normalizeCompetitorRecord({ name: "San Carlo Cicchetti", branch_id: "khobar" });
    expect(row.normalized_name).toBe("san carlo cicchetti");
    expect(row.is_active).toBe(true);
  });

  test("Khobar seed names are registry references only", () => {
    expect(KHOBAR_COMPETITOR_SEED_NAMES).toContain("HOUSE OF AGAPI");
    expect(KHOBAR_COMPETITOR_SEED_NAMES.length).toBeGreaterThanOrEqual(5);
  });

  test("filterActiveCompetitorsForBranch scopes by branch", () => {
    const list = [
      { name: "A", branch_id: "khobar", is_active: true },
      { name: "B", branch_id: "riyadh", is_active: true },
      { name: "C", branch_id: "khobar", is_active: false },
    ];
    const khobar = filterActiveCompetitorsForBranch(list, "khobar");
    expect(khobar).toHaveLength(1);
    expect(khobar[0].name).toBe("A");
  });
});

describe("external signal validation", () => {
  test("validateExternalContextSignalRow accepts weather signal", () => {
    const result = validateExternalContextSignalRow({
      signal_type: EXTERNAL_SIGNAL_TYPES.WEATHER,
      branch_id: "khobar",
      title: "High humidity",
      source_reliability: 0.8,
      confidence: "high",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("validateExternalContextSignalRow rejects unknown type", () => {
    const result = validateExternalContextSignalRow({ signal_type: "unknown", title: "x" });
    expect(result.valid).toBe(false);
  });

  test("validateCompetitorRow requires name", () => {
    expect(validateCompetitorRow({ name: "Urth" }).valid).toBe(true);
    expect(validateCompetitorRow({}).valid).toBe(false);
  });

  test("mapSignalTypeToNilDomain maps weather to weather domain", () => {
    expect(mapSignalTypeToNilDomain(EXTERNAL_SIGNAL_TYPES.WEATHER)).toBe("weather");
    expect(mapSignalTypeToNilDomain(EXTERNAL_SIGNAL_TYPES.PUBLIC_HOLIDAY)).toBe("calendar");
  });
});

describe("externalContextSignalAdapter", () => {
  const competitors = [
    { id: "c1", name: "HOUSE OF AGAPI", normalized_name: "house of agapi", branch_id: "khobar" },
  ];

  test("produces NIL bundle keys from external rows", () => {
    const bundle = adaptExternalContextToNilBundle({
      externalSignals: [
        {
          id: "s1",
          signal_type: EXTERNAL_SIGNAL_TYPES.WEATHER,
          branch_id: "khobar",
          title: "Humidity averaged 76%",
          source_name: "Manual weather log",
          source_reliability: 0.7,
          confidence: "medium",
          metadata: { humidity_pct: 76 },
        },
      ],
      competitors,
      branchLabel: "Khobar",
      periodLabel: "18 June 2026",
      period: { startDate: "2026-06-18", endDate: "2026-06-18" },
    });

    expect(bundle.weatherSignals).toHaveLength(1);
    expect(bundle.weatherSignals[0].metadata.cautiousLanguage).toBe(true);
    expect(hasExternalContextSignals(bundle)).toBe(true);
  });

  test("maps competitor observations with cautious language", () => {
    const bundle = adaptExternalContextToNilBundle({
      competitorObservations: [
        {
          competitor_id: "c1",
          branch_id: "khobar",
          observation_date: "2026-06-18",
          observation_text: "Strong dinner traffic",
          source_type: "manager_report",
          source_reliability: 0.55,
        },
      ],
      competitors,
      branchLabel: "Khobar",
      period: { startDate: "2026-06-18", endDate: "2026-06-18" },
    });

    expect(bundle.competitorSignals).toHaveLength(1);
    expect(bundle.competitorSignals[0].value).toMatch(/may indicate|Observed report/i);
    expect(containsForbiddenCausalityLanguage(bundle.competitorSignals[0].value)).toBe(false);
  });

  test("mergeNilSignalBundles preserves internal and external arrays", () => {
    const merged = mergeNilSignalBundles(
      { internalSignals: [{ metric: "sales_change_pct", value: -10 }] },
      { weatherSignals: [{ label: "Humidity", value: "high" }] },
    );
    expect(merged.internalSignals).toHaveLength(1);
    expect(merged.weatherSignals).toHaveLength(1);
  });

  test("scoreSignalPeriodOverlap returns high for exact overlap", () => {
    const overlap = scoreSignalPeriodOverlap(
      { signal_date: "2026-06-10", start_at: "2026-06-10", end_at: "2026-06-10" },
      { startDate: "2026-06-01", endDate: "2026-06-15" },
    );
    expect(overlap).toBe("high");
  });

  test("adapter output avoids forbidden causality phrasing", () => {
    const bundle = adaptExternalContextToNilBundle({
      externalSignals: [
        {
          signal_type: EXTERNAL_SIGNAL_TYPES.WEATHER,
          title: "Heavy rain",
          description: "Rainfall during lunch service",
          source_name: "Staff report",
        },
      ],
      branchLabel: "Khobar",
    });
    const text = bundle.weatherSignals[0].value;
    expect(containsForbiddenCausalityLanguage(text)).toBe(false);
    expect(text).toMatch(/may have/i);
  });
});

describe("WhatsApp foundation (branch scoping)", () => {
  test("normalizePhoneE164 accepts Saudi format", () => {
    expect(normalizePhoneE164("966501234567")).toBe("+966501234567");
  });

  test("classifyWhatsAppMessage detects help", () => {
    expect(classifyWhatsAppMessage("help").category).toBe(WHATSAPP_MESSAGE_CATEGORIES.HELP);
  });

  test("resolveWhatsAppBranch defaults single-branch GM", () => {
    const result = resolveWhatsAppBranch("show latest cash up", {
      vault_role: "branch_manager",
      primary_branch_id: "khobar",
      allowed_branch_ids: ["khobar"],
      is_active: true,
    });
    expect(result.status).toBe("resolved");
    expect(result.branchId).toBe("khobar");
  });

  test("resolveWhatsAppBranch denies unauthorized branch", () => {
    const result = resolveWhatsAppBranch("Riyadh sales today", {
      vault_role: "branch_manager",
      primary_branch_id: "khobar",
      allowed_branch_ids: ["khobar"],
      is_active: true,
    });
    expect(result.status).toBe("denied");
  });

  test("formatAskNacAnswerForWhatsApp preserves NIL sections", () => {
    const { text, responseType } = formatAskNacAnswerForWhatsApp({
      intent: "vault_business_reasoning",
      title: "Business reasoning · last 7 days",
      branchLabel: "Khobar",
      directAnswer: "Confirmed Facts\n\n* Sales declined 10%\n\nHypotheses\n\n* Traffic may have softened",
    });
    expect(responseType).toBe("nil_why");
    expect(text).toMatch(/Confirmed Facts/);
    expect(text).not.toMatch(/routingDebug/i);
  });
});
