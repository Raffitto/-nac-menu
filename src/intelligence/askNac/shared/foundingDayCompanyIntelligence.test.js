const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function run(body, env = {}) {
  const script = `
    global.Deno = { env: { get: (k) => {
      const map = ${JSON.stringify(env)};
      if (k in map) return map[k];
      return undefined;
    } } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout.trim());
}

describe("Founding Day company intelligence", () => {
  test("1. Founding Day deterministic date resolution", () => {
    const out = run(`
      return {
        y2025: mod.foundingDayDateForYear(2025),
        y2026: mod.foundingDayDateForYear(2026),
        y2027: mod.foundingDayDateForYear(2027),
        occ: mod.resolveHolidayOccurrence("saudi_founding_day", 2026),
      };
    `);
    expect(out.y2025).toBe("2025-02-22");
    expect(out.y2026).toBe("2026-02-22");
    expect(out.y2027).toBe("2027-02-22");
    expect(out.occ.anchorDate).toBe("2026-02-22");
  });

  test("2. three-day event window resolution", () => {
    const out = run(`
      const w = mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2026 });
      return {
        start: w.range.startDate,
        end: w.range.endDate,
        dates: w.dates,
        convention: w.convention,
        label: w.conventionLabel,
      };
    `);
    expect(out.start).toBe("2026-02-21");
    expect(out.end).toBe("2026-02-23");
    expect(out.dates).toEqual(["2026-02-21", "2026-02-22", "2026-02-23"]);
    expect(out.convention).toBe("day_before_anchor_day_after");
    expect(out.label).toMatch(/day before/i);
  });

  test("3. Sunday-first Saudi business-week semantics", () => {
    const out = run(`
      // 2026-02-22 is Sunday
      return {
        idx: mod.sundayFirstWeekdayIndex("2026-02-22"),
        name: mod.weekdayNameSundayFirst("2026-02-22"),
        week: mod.saudiBusinessWeekRange("2026-02-24"),
        weekendFri: mod.isKsaWeekend("2026-02-20"),
        weekendSat: mod.isKsaWeekend("2026-02-21"),
        weekdaySun: mod.isKsaWeekend("2026-02-22"),
      };
    `);
    expect(out.idx).toBe(0);
    expect(out.name).toBe("Sunday");
    expect(out.week.startDate).toBe("2026-02-22");
    expect(out.week.endDate).toBe("2026-02-28");
    expect(out.weekendFri).toBe(true);
    expect(out.weekendSat).toBe(true);
    expect(out.weekdaySun).toBe(false);
  });

  test("4. Khobar 2025 Founding Day → branch not operating / invalid historical baseline", () => {
    const out = run(`
      const state = mod.bootstrapFabricState({
        question: "What did Khobar make over the Founding Day 2025 3-day period?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
      });
      return {
        status: state.feasibility.status,
        reasons: state.feasibility.reasons,
        start: state.periods.current?.startDate,
        end: state.periods.current?.endDate,
        opening: mod.defaultBusinessTimeline.getOpeningDate("khobar"),
      };
    `);
    expect(out.opening).toBe("2025-04-27");
    expect(out.start).toBe("2025-02-21");
    expect(out.end).toBe("2025-02-23");
    expect(out.status).toBe("NOT_ANSWERABLE_AS_REQUESTED");
    expect(out.reasons).toContain("branch_not_operating_in_current_period");
  });

  test("5. Khobar 2026 Founding Day historical event window is allowed", () => {
    const out = run(`
      const state = mod.bootstrapFabricState({
        question: "What did Khobar make over the Founding Day 2026 3-day period?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
      });
      const op = mod.defaultBusinessTimeline.getOperatingStatus("khobar", state.periods.current);
      return {
        status: state.feasibility.status,
        start: state.periods.current?.startDate,
        end: state.periods.current?.endDate,
        operating: op.status,
      };
    `);
    expect(out.start).toBe("2026-02-21");
    expect(out.end).toBe("2026-02-23");
    expect(out.operating).toBe("operating");
    expect(out.status).toBe("ANSWERABLE");
  });

  test("6. canonical Cash Up authority", () => {
    const out = run(`
      return {
        cash: mod.getSourceAuthority("cash_up").authority,
        foodics: mod.getSourceAuthority("foodics").authority,
        override: mod.canSourceOverride("foodics", "cash_up"),
        prefer: mod.preferCanonicalSource(["foodics", "cash_up"]),
      };
    `);
    expect(out.cash).toBe("CANONICAL_STRUCTURED");
    expect(out.override).toBe(false);
    expect(out.prefer).toBe("cash_up");
  });

  test("7. one historical holiday observation lowers forecast confidence", () => {
    const out = run(`
      const hist = mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2026 });
      const next = mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2027 });
      const obs = [mod.buildEventPerformanceObservation({
        eventWindow: hist,
        netSales: 120000,
        covers: 1500,
        coverageRatio: 1,
        source: "cash_up",
      })];
      const forecast = mod.forecastEventWindow({
        targetWindow: next,
        historicalObservations: obs,
        recentBaseline: null,
        branchOperatingInTarget: true,
      });
      return {
        confidence: forecast.confidence,
        count: forecast.historicalObservationCount,
        kind: forecast.kind,
        ok: forecast.ok,
      };
    `);
    expect(out.kind).toBe("FORECAST");
    expect(out.count).toBe(1);
    expect(out.confidence).toBe("low");
    expect(out.ok).toBe(true);
  });

  test("8. forecast output is not presented as observed fact", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "What should we expect next Founding Day for Khobar?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
        executor: mod.createMockCapabilityExecutor({
          "commercial.performance": {
            capability: "commercial.performance",
            implementationTool: "cash_up_performance",
            ok: true,
            metrics: [{ key: "net_sales", value: 120000, unit: "SAR" }, { key: "covers", value: 1500 }],
            textSnippets: ["Cash Up performance"],
            coverage: mod.buildCoverageReport({
              domain: "sales",
              range: { startDate: "2026-02-21", endDate: "2026-02-23" },
              expectedRecords: 3,
              availableRecords: 3,
            }),
          },
        }),
      });
      const forecastClaims = result.state.claims.filter((c) => c.type === "FORECAST");
      return {
        answer: result.answerText,
        forecastClaims: forecastClaims.length,
        hasForecastWord: /forecast|estimate|expectation/i.test(result.answerText),
        presentsAsObservedWill: /\\bwill (be|make)\\b/i.test(result.answerText) && !/forecast|estimate|expectation/i.test(result.answerText),
      };
    `);
    expect(out.forecastClaims).toBeGreaterThan(0);
    expect(out.hasForecastWord).toBe(true);
    expect(out.presentsAsObservedWill).toBe(false);
    expect(out.answer).toMatch(/FORECAST/i);
  });

  test("9. weekday-composition difference affects comparability/forecast metadata", () => {
    const out = run(`
      const hist = mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2026 });
      const next = mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2027 });
      const cmp = mod.assessComparability({
        current: next.range,
        comparison: hist.range,
      });
      const forecast = mod.forecastEventWindow({
        targetWindow: next,
        historicalObservations: [mod.buildEventPerformanceObservation({
          eventWindow: hist,
          netSales: 100000,
          coverageRatio: 1,
        })],
      });
      return {
        histSig: hist.weekdayComposition.signature,
        nextSig: next.weekdayComposition.signature,
        cmpMatch: cmp.weekdayComposition?.match,
        method: cmp.recommendedMethod,
        forecastMatch: forecast.weekdayCompositionMatch,
        notes: forecast.comparabilityNotes,
      };
    `);
    expect(out.histSig).not.toBe(out.nextSig);
    expect(out.cmpMatch).toBe(false);
    expect(out.method).toBe("matched_weekday");
    expect(out.forecastMatch).toBe(false);
    expect(out.notes.join(" ")).toMatch(/weekday_composition_differs/);
  });

  test("10. no unsupported external causality", () => {
    const out = run(`
      const text = "Sales will rise because of weather and political effects.";
      const causal = mod.assessCausalLanguage(text, [], []);
      const forecast = mod.forecastEventWindow({
        targetWindow: mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2027 }),
        historicalObservations: [mod.buildEventPerformanceObservation({
          eventWindow: mod.resolveEventWindow({ holidayId: "saudi_founding_day", year: 2026 }),
          netSales: 90000,
        })],
      });
      return {
        causalOk: causal.ok,
        includesExternal: forecast.includesExternalFactors,
        limitations: forecast.limitations,
      };
    `);
    expect(out.causalOk).toBe(false);
    expect(out.includesExternal).toBe(false);
    expect(out.limitations).toContain("external_factors_not_modeled");
  });

  test("11. next Founding Day returned deterministically", () => {
    const out = run(`
      const next = mod.resolveNextHoliday("saudi_founding_day", "2026-08-10");
      const temporal = mod.defaultTemporalService.resolveFromQuestion(
        "When is the next Founding Day and what should sales look like?",
        new Date("2026-08-10T12:00:00+03:00"),
      );
      return {
        next: next.anchorDate,
        fromTemporal: temporal.nextHolidayDate,
      };
    `);
    expect(out.next).toBe("2027-02-22");
    expect(out.fromTemporal).toBe("2027-02-22");
  });

  test("12. natural-language management variants route to same semantic capability/path", () => {
    const variants = [
      "How did we do around Founding Day?",
      "What did Khobar make over the Founding Day 3-day period?",
      "What should we expect next Founding Day?",
      "Compare this Founding Day period with what we should expect next year.",
      "When is the next Founding Day and what should sales look like?",
      "The three days that include Saudi Founding Day, how were the sales, what are the expectations for next Founding Day, and when is it?",
    ];
    const out = run(`
      const variants = ${JSON.stringify(variants)};
      const ref = new Date("2026-08-10T12:00:00+03:00");
      return variants.map((q) => {
        const intent = mod.detectHolidayQuestionIntent(q);
        const temporal = mod.defaultTemporalService.resolveFromQuestion(q, ref);
        const plan = mod.planManagementQuestionHeuristic
          ? null
          : null;
        return {
          detected: intent.detected,
          holidayId: intent.holidayId,
          expression: temporal.expression,
          hasWindow: Boolean(temporal.eventWindow || temporal.range),
          caps: intent.wantsForecast ? ["commercial.forecast"] : ["commercial.performance"],
        };
      });
    `);
    for (const row of out) {
      expect(row.detected).toBe(true);
      expect(row.holidayId).toBe("saudi_founding_day");
      expect(row.hasWindow).toBe(true);
      expect(row.expression).toMatch(/founding_day/);
    }

    const planner = run(`
      const q = "The three days that include Saudi Founding Day, how were the sales, what are the expectations for next Founding Day, and when is it?";
      // Import planner from sibling module via dynamic import path relative to fabric is hard;
      // assert orchestration path instead.
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: q,
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "heuristic",
        executor: mod.createMockCapabilityExecutor({
          "commercial.performance": {
            capability: "commercial.performance",
            implementationTool: "cash_up_performance",
            ok: true,
            metrics: [{ key: "net_sales", value: 110000, unit: "SAR" }],
            textSnippets: ["Cash Up"],
            coverage: mod.buildCoverageReport({
              domain: "sales",
              range: { startDate: "2026-02-21", endDate: "2026-02-23" },
              expectedRecords: 3,
              availableRecords: 3,
            }),
          },
        }),
      });
      return {
        caps: result.state.plan.capabilities,
        next: result.state.periods.nextHolidayDate,
        window: result.state.periods.eventWindow,
        answer: result.answerText,
      };
    `);
    expect(planner.caps).toEqual(expect.arrayContaining([
      "calendar.resolve_period",
      "commercial.performance",
      "commercial.forecast",
    ]));
    expect(planner.next).toBe("2027-02-22");
    expect(planner.window?.convention).toBe("day_before_anchor_day_after");
    expect(planner.answer).toMatch(/2027-02-22/);
  });

  test("13. cloud-off / deterministic path degrades safely if model unavailable", () => {
    const out = run(`
      const result = await mod.runCompanyIntelligenceOrchestration({
        question: "When is the next Founding Day and what should sales look like for Khobar?",
        branchHint: "khobar",
        referenceDate: new Date("2026-08-10T12:00:00+03:00"),
        mode: "offline",
        maxPaidCalls: 0,
        executor: mod.createMockCapabilityExecutor({
          "commercial.performance": {
            capability: "commercial.performance",
            implementationTool: "cash_up_performance",
            ok: true,
            metrics: [{ key: "net_sales", value: 100000, unit: "SAR" }],
            textSnippets: ["Cash Up"],
            coverage: mod.buildCoverageReport({
              domain: "sales",
              range: { startDate: "2026-02-21", endDate: "2026-02-23" },
              expectedRecords: 3,
              availableRecords: 3,
            }),
          },
        }),
      });
      return {
        paid: result.paidModelCalls,
        next: result.state.periods.nextHolidayDate,
        answer: result.answerText,
        offlineNote: /offline mode/i.test(result.answerText),
      };
    `, {
      MODEL_GATEWAY_CLOUD_ENABLED: "false",
    });
    expect(out.paid).toBe(0);
    expect(out.next).toBe("2027-02-22");
    expect(out.answer).toMatch(/2027-02-22/);
    expect(out.answer).toMatch(/FORECAST|estimate|expectation/i);
  });

  test("14. no Foodics shift-segmentation claim", () => {
    const out = run(`
      const policy = mod.shiftSegmentationAuthority();
      const mayFoodics = mod.mayUseSourceForShiftSegmentation("foodics");
      const mayCash = mod.mayUseSourceForShiftSegmentation("cash_up");
      const verified = mod.verifySynthesizedAnswer({
        answerText: "Foodics shift sales show lunch was weak.",
        evidence: [],
        claims: [],
        presentedSources: ["foodics"],
      });
      return {
        canonical: policy.canonicalSourceId,
        rejected: policy.rejectedSourceIds,
        mayFoodics,
        mayCash,
        issueCodes: verified.issues.map((i) => i.code),
      };
    `);
    expect(out.canonical).toBe("cash_up");
    expect(out.rejected).toContain("foodics");
    expect(out.mayFoodics).toBe(false);
    expect(out.mayCash).toBe(true);
    expect(out.issueCodes).toContain("foodics_shift_segmentation_claim");
  });
});
