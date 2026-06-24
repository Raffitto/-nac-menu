import {
  buildCompilerProfile,
  completeCompilerStage,
  failCompilerStage,
  normalizeLegacyStage,
  setCompilerManifest,
  startCompilerStage,
} from "./compilerStageTracking";

function createMockSupabase(initialRow = {}) {
  let row = {
    compiler_stages: [],
    compilation_manifest: {},
    compiler_profile: null,
    compiler_version: null,
    ...initialRow,
  };
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: row, error: null }),
              };
            },
          };
        },
        update(patch) {
          row = { ...row, ...patch };
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
    getRow: () => row,
  };
}

describe("compilerStageTracking", () => {
  test("normalizeLegacyStage maps legacy parse stage", () => {
    expect(normalizeLegacyStage({ stage: "parse" })).toBe("legacy_parse");
    expect(normalizeLegacyStage({ compiler_stage: "publish" })).toBe("publish");
    expect(normalizeLegacyStage({ stage: "facts_published" })).toBe("publish");
  });

  test("buildCompilerProfile uses domain and report type", () => {
    expect(buildCompilerProfile({ knowledgeDomain: "operations", reportType: "cash_up" })).toBe(
      "operations:cash_up",
    );
  });

  test("start and complete append stage records", async () => {
    const supabase = createMockSupabase();
    const jobId = "job-1";
    await startCompilerStage(supabase, jobId, "classify", { reportType: "cash_up" });
    await completeCompilerStage(supabase, jobId, "classify", { ok: true });
    const row = supabase.getRow();
    expect(row.compiler_stages).toHaveLength(1);
    expect(row.compiler_stages[0].stage).toBe("classify");
    expect(row.compiler_stages[0].status).toBe("completed");
    expect(row.compiler_stages[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(row.compiler_stage).toBe("classify");
  });

  test("failCompilerStage records error without throwing", async () => {
    const supabase = createMockSupabase();
    const jobId = "job-2";
    await startCompilerStage(supabase, jobId, "legacy_parse");
    await failCompilerStage(supabase, jobId, "legacy_parse", "parse exploded");
    const row = supabase.getRow();
    expect(row.compiler_stages[0].status).toBe("failed");
    expect(row.compiler_stages[0].error).toBe("parse exploded");
  });

  test("setCompilerManifest merges patches", async () => {
    const supabase = createMockSupabase({ compilation_manifest: { factsPersisted: 1 } });
    await setCompilerManifest(supabase, "job-3", { publish: true });
    expect(supabase.getRow().compilation_manifest).toEqual({ factsPersisted: 1, publish: true });
  });

  test("stage logging failure does not throw to caller", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "db down" } }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: { message: "db down" } }),
        }),
      }),
    };
    await expect(startCompilerStage(broken, "job-x", "classify")).resolves.toBe(false);
    await expect(completeCompilerStage(broken, "job-x", "classify")).resolves.toBe(false);
  });
});
