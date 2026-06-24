import { normalizeLegacyStage } from "../vault/compilerStageTracking";

export function summarizeCompilerStageDiagnostics(jobs = []) {
  const byCompilerStage = {};
  const byLegacyNormalized = {};
  const failedStages = [];
  const recentDurations = [];

  for (const job of jobs || []) {
    const current = job.compiler_stage || normalizeLegacyStage(job) || "unknown";
    byCompilerStage[current] = (byCompilerStage[current] || 0) + 1;
    const normalized = normalizeLegacyStage(job) || "unknown";
    byLegacyNormalized[normalized] = (byLegacyNormalized[normalized] || 0) + 1;

    for (const stage of job.compiler_stages || []) {
      if (stage.status === "failed") {
        failedStages.push({
          jobId: job.id,
          stage: stage.stage,
          error: stage.error || job.error || null,
          reportType: job.reportType || job.report_type || null,
        });
      }
      if (stage.duration_ms != null && stage.status === "completed") {
        recentDurations.push({
          stage: stage.stage,
          durationMs: stage.duration_ms,
          jobId: job.id,
        });
      }
    }
  }

  recentDurations.sort((a, b) => b.durationMs - a.durationMs);

  return {
    jobCount: jobs.length,
    jobsWithCompilerStages: jobs.filter((j) => (j.compiler_stages || []).length > 0).length,
    byCompilerStage,
    byLegacyNormalized,
    failedStages: failedStages.slice(0, 12),
    latestStageDurations: recentDurations.slice(0, 12),
  };
}
