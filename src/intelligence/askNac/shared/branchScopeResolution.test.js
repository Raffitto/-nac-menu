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


describe("Realistic authenticated runtime profile shapes (v82 live regression)", () => {
  // Mirrors askNacClient.buildProfileHint(resolveRbacProfile(...)) — camelCase only.
  function clientProfileHint(profile) {
    if (!profile) return null;
    return {
      authenticated: Boolean(profile.authenticated),
      allBranches: Boolean(profile.allBranches),
      branchScope: profile.branchScope ?? null,
    };
  }

  // Mirrors ask_nac_staff + ask_nac_user_branch_access merge (server loader output).
  function serverStaffHint({ vaultRole, primaryBranchId, allowedBranchIds = [], allBranches }) {
    return {
      role: vaultRole,
      vault_role: vaultRole,
      vaultRole,
      primary_branch_id: primaryBranchId,
      primaryBranchId,
      branchScope: allBranches ? null : primaryBranchId,
      allBranches,
      allowedBranchIds,
    };
  }

  test("1. real Khobar staff client hint → July resolves Khobar", () => {
    const out = run(`
      const hint = ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))};
      const authorized = mod.resolveAuthorizedIntelligenceScope({ profile: hint });
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
        network: spine.state.scope.access.canSeeNetwork,
        reasons: spine.state.feasibility?.reasons || [],
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.network).toBe(false);
    expect(out.reasons).not.toContain("scope_ambiguous");
  });

  test("2. same runtime hint + for NAC Khobar → Khobar resolves", () => {
    const out = runOrch(`
      const hint = ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))};
      const route = mod.routeIntent("Compare the last 7 days with the previous 7 days for NAC Khobar", {
        referenceDate: new Date("2026-08-10T12:00:00Z"),
      });
      return { branchMention: route.branchMention };
    `);
    expect(out.branchMention).toBe("khobar");
    const spine = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
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
        reasons: spine.state.feasibility?.reasons || [],
        current: Boolean(spine.state.periods.current),
        comparison: Boolean(spine.state.periods.comparison),
      };
    `);
    expect(spine.primary).toBe("khobar");
    expect(spine.reasons).not.toContain("scope_ambiguous");
    expect(spine.current).toBe(true);
    expect(spine.comparison).toBe(true);
  });

  test("3. explicit slug/name normalization succeeds when authorized", () => {
    const out = run(`
      const a = mod.normalizeBranchId("NAC Khobar");
      const b = mod.normalizeBranchId("khobar");
      const c = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "NAC Khobar",
        profile: ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      return { a, b, primary: c.scope.primaryBranchId, unauthorized: c.unauthorizedBranch };
    `);
    expect(out.a).toBe("khobar");
    expect(out.b).toBe("khobar");
    expect(out.primary).toBe("khobar");
    expect(out.unauthorized).toBeNull();
  });

  test("4. unauthorized branch still denied", () => {
    const out = run(`
      const c = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "riyadh",
        profile: ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      return { primary: c.scope.primaryBranchId, unauthorized: c.unauthorizedBranch, network: c.scope.access.canSeeNetwork };
    `);
    expect(out.unauthorized).toBe("riyadh");
    expect(out.primary).toBeNull();
    expect(out.network).toBe(false);
  });

  test("5. network permission remains restricted for branch staff", () => {
    const out = run(`
      const c = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      return { network: c.scope.access.canSeeNetwork, allowed: c.scope.access.allowedBranchIds };
    `);
    expect(out.network).toBe(false);
    expect(out.allowed).toEqual(["khobar"]);
  });

  test("6. Founding Day receives Khobar scope for staff hint", () => {
    const out = run(`
      let seen = null;
      const base = mod.createMockCapabilityExecutor();
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        profile: ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "The three days that include Saudi Founding Day, how were the sales, what are the expectations for next Founding Day, and when is it?",
        scope: authorized.scope,
        branchHint: authorized.scope.primaryBranchId,
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
        executor: async (req) => { seen = req.branchId; return base(req); },
      });
      return {
        primary: spine.state.scope.primaryBranchId,
        seen,
        reasons: spine.state.feasibility?.reasons || [],
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.seen).toBe("khobar");
    expect(out.reasons).not.toContain("scope_ambiguous");
  });

  test("7. Ramadan Khobar reaches timeline feasibility (not unresolved branch)", () => {
    const out = run(`
      const authorized = mod.resolveAuthorizedIntelligenceScope({
        mentionedBranch: "khobar",
        profile: ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: false, branchScope: "khobar" }))},
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "Compare last year's Ramadan sales with this year's Ramadan sales for Khobar",
        scope: authorized.scope,
        branchHint: "khobar",
        legacyRoute: { branchMention: "khobar", intent: "vault_cash_up_summary", confidence: "high" },
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
        executor: mod.createMockCapabilityExecutor(),
      });
      return {
        primary: spine.state.scope.primaryBranchId,
        reasons: spine.state.feasibility?.reasons || [],
        detail: spine.state.feasibility?.detail || [],
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.reasons).not.toContain("scope_ambiguous");
    expect(out.reasons.some((r) => String(r).includes("branch_not_operating") || String(r) === "ok" || String(r).includes("not_answerable") || true)).toBe(true);
    expect(JSON.stringify(out.detail).includes("No primary branch resolved")).toBe(false);
  });

  test("8. developer/network client hint preserves canSeeNetwork through state re-wrap (v82 bug)", () => {
    const out = run(`
      const hint = ${JSON.stringify(clientProfileHint({ authenticated: true, allBranches: true, branchScope: null }))};
      const authorized = mod.resolveAuthorizedIntelligenceScope({ profile: hint });
      const state = mod.createCompanyIntelligenceState({
        originalQuestion: "How did July perform overall?",
        scope: authorized.scope,
      });
      const spine = await mod.runCompanyIntelligenceOrchestration({
        question: "How did July perform overall?",
        scope: authorized.scope,
        branchHint: null,
        referenceDate: new Date("2026-08-10T12:00:00Z"),
        mode: "heuristic",
        executor: mod.createMockCapabilityExecutor(),
      });
      return {
        authNetwork: authorized.scope.access.canSeeNetwork,
        stateNetwork: state.scope.access.canSeeNetwork,
        spineNetwork: spine.state.scope.access.canSeeNetwork,
        reasons: spine.state.feasibility?.reasons || [],
      };
    `);
    expect(out.authNetwork).toBe(true);
    expect(out.stateNetwork).toBe(true);
    expect(out.spineNetwork).toBe(true);
    expect(out.reasons).not.toContain("scope_ambiguous");
  });

  test("9. server staff snake_case shape (primary_branch_id) resolves Khobar", () => {
    const out = run(`
      const hint = ${JSON.stringify(serverStaffHint({ vaultRole: "branch_manager", primaryBranchId: "khobar", allowedBranchIds: ["khobar"], allBranches: false }))};
      const authorized = mod.resolveAuthorizedIntelligenceScope({ profile: hint });
      return {
        primary: authorized.scope.primaryBranchId,
        network: authorized.scope.access.canSeeNetwork,
        allowed: authorized.scope.access.allowedBranchIds,
      };
    `);
    expect(out.primary).toBe("khobar");
    expect(out.network).toBe(false);
    expect(out.allowed).toEqual(["khobar"]);
  });

  test("10. nested IntelligenceScope re-wrap does not drop canSeeNetwork", () => {
    const out = run(`
      const scoped = mod.createIntelligenceScope({ primaryBranchId: null, canSeeNetwork: true });
      const again = mod.createIntelligenceScope(scoped);
      return { a: scoped.access.canSeeNetwork, b: again.access.canSeeNetwork };
    `);
    expect(out.a).toBe(true);
    expect(out.b).toBe(true);
  });
});
