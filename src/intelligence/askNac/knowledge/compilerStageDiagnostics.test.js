import { summarizeCompilerStageDiagnostics } from "./compilerStageDiagnostics";
import { normalizeLegacyStage } from "../vault/compilerStageTracking";

describe("compilerStageDiagnostics", () => {
  test("summarizes jobs by compiler stage and failed stages", () => {
    const summary = summarizeCompilerStageDiagnostics([
      {
        id: "j1",
        compiler_stage: "publish",
        compiler_stages: [
          { stage: "classify", status: "completed", duration_ms: 12 },
          { stage: "publish", status: "completed", duration_ms: 90 },
        ],
        reportType: "cash_up",
      },
      {
        id: "j2",
        stage: "parse",
        compiler_stages: [],
        reportType: "daily_logbook",
      },
    ]);
    expect(summary.jobsWithCompilerStages).toBe(1);
    expect(summary.byCompilerStage.publish).toBe(1);
    expect(normalizeLegacyStage({ stage: "parse" })).toBe("legacy_parse");
    expect(summary.byLegacyNormalized.legacy_parse).toBe(1);
    expect(summary.latestStageDurations[0].durationMs).toBe(90);
  });
});
