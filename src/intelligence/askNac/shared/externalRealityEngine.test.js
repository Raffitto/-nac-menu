const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function run(body) {
  const script = `
    global.Deno = { env: { get: (k) => process.env[k] } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(String(err && err.stack || err)); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NAC_ALLOW_EXTERNAL_FETCH: "" },
  }).trim());
}

const MOCK_WEATHER = `
function mockWeather(mean, hot) {
  return async (url) => {
    const u = String(url);
    const bump = /start_date=2026-02/.test(u) ? -3 : 0;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        daily: {
          temperature_2m_mean: Array(10).fill(mean + bump),
          temperature_2m_max: Array(10).fill(mean + 6 + bump),
          apparent_temperature_mean: Array(10).fill(mean + 2 + bump),
          relative_humidity_2m_mean: Array(10).fill(40),
          precipitation_sum: Array(10).fill(0),
          wind_speed_10m_max: Array(10).fill(15),
          weather_code: Array(10).fill(0),
        },
      }),
    };
  };
}
`;

describe("external reality engine v1", () => {
  test("cost governor blocks paid class 3 and prefers cache", () => {
    const out = run(`
      const paid = mod.allowExternalCost(3);
      const cached = mod.allowExternalCost(1, { alreadyCached: true });
      const free = mod.allowExternalCost(1);
      const traffic = mod.EXTERNAL_CONTEXT_REGISTRY.find((s) => s.category === "traffic");
      return { paid, cached, free, traffic: traffic.status, openclaw: mod.OSS_REFERENCE_REGISTRY.find((x) => x.name === "OpenClaw").adoption };
    `);
    expect(out.paid.allowed).toBe(false);
    expect(out.cached.costClass).toBe(0);
    expect(out.free.allowed).toBe(true);
    expect(out.traffic).toBe("UNAVAILABLE_IN_FOUNDER_FREE_MODE");
    expect(out.openclaw).toBe("REJECTED");
  });

  test("Khobar resolves to Grand House coordinates without geocoding", () => {
    const out = run(`
      return mod.resolveBranchLocation("khobar");
    `);
    expect(out.site).toMatch(/Grand House Open Mall/i);
    expect(out.lat).toBeCloseTo(26.3055, 3);
    expect(out.persist).toBe(true);
  });

  test("temporal alignment uses matched day counts not full unmatched months", () => {
    const out = run(`
      return mod.alignedComparisonWindow(
        { startDate: "2026-08-01", endDate: "2026-08-17", label: "Aug 1-17" },
        { startDate: "2026-07-01", endDate: "2026-07-31", label: "July" },
      );
    `);
    expect(out.current.startDate).toBe("2026-08-01");
    expect(out.current.endDate).toBe("2026-08-17");
    expect(out.comparison.startDate).toBe("2026-07-15");
    expect(out.comparison.endDate).toBe("2026-07-31");
    expect(out.currentDates).toHaveLength(17);
    expect(out.comparisonDates).toHaveLength(17);
  });

  test("cache reuse does not refetch weather", () => {
    const out = run(`
      ${MOCK_WEATHER}
      mod.resetExternalFactStoreForTests();
      mod.resetWeatherCallCount();
      const period = { startDate: "2026-07-01", endDate: "2026-07-10" };
      const a = await mod.fetchAlignedWeather({ branchId: "khobar", period, deps: { fetchImpl: mockWeather(38, 8) } });
      const b = await mod.fetchAlignedWeather({ branchId: "khobar", period, deps: { fetchImpl: mockWeather(38, 8) } });
      return { calls: mod.weatherExternalCallCount(), aCached: a.summary.cached, bCached: b.summary.cached, mean: a.summary.meanTempC };
    `);
    expect(out.calls).toBe(1);
    expect(out.aCached).toBe(false);
    expect(out.bCached).toBe(true);
    expect(out.mean).toBe(38);
  });

  test("hypothesis planner is not a phrase handler and stops when internal is enough", () => {
    const out = run(`
      const enough = mod.planExternalHypotheses({
        question: "Why were sales weaker last month?",
        unexplainedSignal: "internally_sufficient",
        current: { startDate: "2026-07-01", endDate: "2026-07-31" },
        comparison: { startDate: "2026-06-01", endDate: "2026-06-30" },
      });
      const unexplained = mod.planExternalHypotheses({
        question: "Why were sales weaker last month?",
        unexplainedSignal: "demand_covers_driven",
        current: { startDate: "2026-07-01", endDate: "2026-07-31" },
        comparison: { startDate: "2026-06-01", endDate: "2026-06-30" },
      });
      const weatherQ = mod.planExternalHypotheses({
        question: "Did the weather affect us last month?",
        unexplainedSignal: "internally_sufficient",
        current: { startDate: "2026-07-01", endDate: "2026-07-31" },
        comparison: null,
      });
      const janFeb = mod.shouldConsiderExternalReality("compare January to February in terms of nb of guests and sales", "comparison");
      return {
        enough: enough.stopReason,
        tools: unexplained.selectedTools,
        n: unexplained.candidateHypotheses.length,
        weatherForced: weatherQ.selectedTools,
        janFeb,
      };
    `);
    expect(out.enough).toBe("internal_evidence_sufficient");
    expect(out.n).toBeLessThanOrEqual(4);
    expect(out.tools).toEqual(expect.arrayContaining(["external.weather"]));
    expect(out.weatherForced).toContain("external.weather");
    expect(out.janFeb).toBe(false);
  });

  test("sports negative evidence when no overlap", () => {
    const out = run(`
      ${MOCK_WEATHER}
      mod.resetExternalFactStoreForTests();
      const res = await mod.runExternalRealityEngine({
        question: "Were weekends with major football games different?",
        branchId: "khobar",
        current: { startDate: "2026-08-01", endDate: "2026-08-17" },
        comparison: { startDate: "2026-07-01", endDate: "2026-07-17" },
        evidence: [{ metricOrEvent: "delta_pct", value: -8, source: "cash_up", sourceAuthority: "CANONICAL_STRUCTURED", domain: "INTERNAL_STRUCTURED", textSummary: "d" }],
        weatherDeps: { fetchImpl: mockWeather(36, 4) },
      });
      const sports = res.findings.find((f) => f.category === "sports_events");
      return { rejected: sports.rejectedHypothesis, text: sports.statement, paid: res.paidCalls, caused: /caused sales/i.test(res.answerSection) };
    `);
    expect(out.rejected).toBe(true);
    expect(out.text).toMatch(/unlikely to be a major explanation/i);
    expect(out.paid).toBe(0);
    expect(out.caused).toBe(false);
  });

  test("past 3 months uses internal first then selected external hypotheses", () => {
    const out = run(`
      ${MOCK_WEATHER}
      mod.resetExternalFactStoreForTests();
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "Why were sales low over the past 3 months?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-18T12:00:00+03:00"),
        mode: "heuristic",
        externalReality: { weatherDeps: { fetchImpl: mockWeather(39, 12) } },
      });
      return {
        answer: result.answerText,
        tools: result.toolsExecuted,
        warnings: result.state.warnings.filter((w) => String(w).startsWith("external_")),
        period: result.state.periods,
        caps: result.state.plan.capabilities,
        caused: /heat caused/i.test(result.answerText || ""),
        worldCup: /World Cup/i.test(result.answerText || ""),
        school: /school/i.test(result.answerText || ""),
        internal: /Internal drivers|Cash Up|net sales/i.test(result.answerText || ""),
        unknown: String(result.answerText || "").includes("Unknown/unproven"),
        external: /External context/i.test(result.answerText || ""),
      };
    `);
    expect(out.caused).toBe(false);
    expect(out.worldCup).toBe(true);
    expect(out.school).toBe(true);
    expect(out.unknown).toBe(true);
    expect(out.tools.join(" ")).toMatch(/external\.weather|external\.sports|external\.calendar/);
    expect(out.warnings.some((w) => /external_paid:0/.test(w))).toBe(true);
  });

  test("acceptance questions share the same engine", () => {
    const out = run(`
      ${MOCK_WEATHER}
      const qs = [
        "Did the weather affect us last month?",
        "Were weekends with major football games different?",
        "Was the school holiday period weaker than normal?",
        "Anything outside the restaurant that might explain the decline?",
        "What external factors coincided with our strongest days?",
      ];
      const plans = qs.map((question) => mod.planExternalHypotheses({
        question,
        unexplainedSignal: "demand_covers_driven",
        current: { startDate: "2026-07-01", endDate: "2026-07-31" },
        comparison: { startDate: "2026-06-01", endDate: "2026-06-30" },
      }));
      return plans.map((p, i) => ({ q: qs[i], tools: p.selectedTools, n: p.candidateHypotheses.length }));
    `);
    expect(out[0].tools).toContain("external.weather");
    expect(out[1].tools).toContain("external.sports");
    expect(out[2].tools).toContain("external.calendar");
    expect(out[3].n).toBeGreaterThan(1);
    expect(out[3].n).toBeLessThanOrEqual(4);
    expect(out[4].tools.length).toBeGreaterThan(1);
    expect(out.every((row) => row.n <= 4)).toBe(true);
  });

  test("RBAC still requires a known branch location", () => {
    const out = run(`
      return {
        ok: mod.resolveBranchLocation("khobar"),
        denied: mod.resolveBranchLocation("al-quoz-2"),
      };
    `);
    expect(out.ok.branchId).toBe("khobar");
    expect(out.denied).toBeNull();
  });

  test("unavailable traffic is explicit not invented", () => {
    const out = run(`
      return mod.trafficUnavailableFinding();
    `);
    expect(out.statement).toMatch(/UNAVAILABLE_IN_FOUNDER_FREE_MODE/);
    expect(out.costClass).toBe(3);
  });
});
