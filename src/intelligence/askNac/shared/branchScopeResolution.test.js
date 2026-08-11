/**
 * v81 regression: authenticated primary branch must reach Fabric scope.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");
const orchPath = path.join(root, "supabase/functions/_shared/askNacOrchestrator.ts");

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(stdout.trim());
}

function runOrch(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(orchPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(stdout.trim());
}

describe("Authorized branch scope resolution (v81 regression)", () => {
  test("1. Khobar staff + no branch in question → primary Khobar", () => {
    const out = run(`
      const out = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: null,
        filterBranch: null,
        profile: { allBranches: false, branchScope: "khobar" },
      });
      return {
        primary: out.scope.primaryBranchId,
        network: out.scope.access.canSeeNetwork,
        unauthorized: out.unauthorizedBranch,
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.network).toBe(false);
    expect(out.unauthorized).toBeNull();
  });

  test("2. July overall with Khobar staff → commercial scope has branch", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: { allBranches: false, branchScope: "khobar" },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        branchHint: authorized.scope.primaryBranchId,
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
        executor: mod.createMockCapabilityExecutor(),
      });
      return {
        primary: spine.state.scope.primaryBranchId,
        reasons: spine.state.feasibility?.reasons || [],
        answer: spine.answerText || "",
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.reasons).not.toContain("scope_ambiguous");
    expect(out.answer).not.toMatch(/No primary branch resolved/i);
  });

  test("3. Explicit NAC Khobar compare reaches comparison with branch", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: { allBranches: false, branchScope: "khobar" },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare the last 7 days with the previous 7 days for NAC Khobar",
        scope: authorized.scope,
        branchHint: "khobar",
        legacyRoute: { branchMention: "khobar", intent: "vault_cash_up_summary", confidence: "high" },
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
        executor: mod.createMockCapabilityExecutor(),
      });
      return {
        primary: spine.state.scope.primaryBranchId,
        current: Boolean(spine.state.periods.current),
        comparison: Boolean(spine.state.periods.comparison),
        reasons: spine.state.feasibility?.reasons || [],
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.current).toBe(true);
    expect(out.comparison).toBe(true);
    expect(out.reasons).not.toContain("scope_ambiguous");
  });

  test("4. Unauthorized explicit branch denied", () => {
    const out = run(`
      const out = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "riyadh",
        profile: { allBranches: false, branchScope: "khobar" },
      });
      return { unauthorized: out.unauthorizedBranch, primary: out.scope.primaryBranchId };
    `);
    expect(out.unauthorized).toBe("riyadh");
    expect(out.primary).toBeNull();
  });

  test("5. Network not allowed does not block primary branch resolution", () => {
    const out = run(`
      const out = mod.resolveAuthorizedIntelligenceScope({
        profile: { allBranches: false, branchScope: "khobar" },
      });
      return { network: out.scope.access.canSeeNetwork, primary: out.scope.primaryBranchId };
    `);
    expect(out.network).toBe(false);
    expect(out.primary).toBe("khobar");
  });

  test("6. Founding Day for Khobar staff carries branch into spine", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: { allBranches: false, branchScope: "khobar" },
      });
      let seenBranch = null;
      const base = mod.createMockCapabilityExecutor();
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "The three days that include Saudi Founding Day, how were the sales, what are the expectations for next Founding Day, and when is it?",
        scope: authorized.scope,
        branchHint: authorized.scope.primaryBranchId,
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
        executor: async (req) => {
          seenBranch = req.branchId;
          return base(req);
        },
      });
      return {
        primary: spine.state.scope.primaryBranchId,
        seenBranch,
        reasons: spine.state.feasibility?.reasons || [],
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.reasons).not.toContain("scope_ambiguous");
  });

  test("7. Ramadan Khobar reaches timeline feasibility (not unresolved branch)", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: { allBranches: false, branchScope: "khobar" },
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare last year's Ramadan sales with this year's Ramadan sales for Khobar.",
        scope: authorized.scope,
        branchHint: "khobar",
        legacyRoute: { branchMention: "khobar" },
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
      });
      return {
        primary: spine.state.scope.primaryBranchId,
        reasons: spine.state.feasibility?.reasons || [],
        detail: (spine.state.feasibility?.detail || []).join(" "),
        answer: spine.answerText || "",
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.reasons).not.toContain("scope_ambiguous");
    expect(out.answer).not.toMatch(/No primary branch resolved/i);
  });

  test("8. Network-authorized user preserves canSeeNetwork", () => {
    const out = run(`
      const out = mod.resolveAuthorizedIntelligenceScope({
        profile: { allBranches: true, branchScope: null },
      });
      return {
        network: out.scope.access.canSeeNetwork,
        primary: out.scope.primaryBranchId,
        unauthorized: out.unauthorizedBranch,
      };
    `);
    expect(out.network).toBe(true);
    expect(out.primary).toBeNull();
    expect(out.unauthorized).toBeNull();
  });

  test("9. No silent Khobar default for empty profile", () => {
    const out = run(`
      const out = mod.resolveAuthorizedIntelligenceScope({
        profile: { allBranches: false, branchScope: null },
      });
      return { primary: out.scope.primaryBranchId };
    `);
    expect(out.primary).toBeNull();
  });

  test("10. routeIntent referenceDate still honored", () => {
    const out = runOrch(`
      const route = mod.routeIntent(
        "What are the biggest operational issues from the last 10 days?",
        { referenceDate: new Date("2026-08-10T12:00:00.000Z") },
      );
      return {
        start: route.vaultPeriod?.startDate || null,
        end: route.vaultPeriod?.endDate || null,
      };
    `);
    expect(out.start).toBe("2026-08-01");
    expect(out.end).toBe("2026-08-10");
  });
});
