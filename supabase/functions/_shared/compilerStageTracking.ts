/**
 * Compiler stage observability — Edge mirror (non-blocking).
 */

export const COMPILER_OBSERVABILITY_VERSION = "compiler-observability-v0";

const LEGACY_STAGE_MAP: Record<string, string> = {
  parse: "legacy_parse",
  extract: "legacy_parse",
  persist: "publish",
  registry_only: "classify",
  chunks_indexed: "legacy_chunk",
  drive_ingest: "legacy_drive_ingest",
  raw_extract_only: "legacy_parse",
  facts_published: "publish",
  facts_published_with_warnings: "publish",
};

type SupabaseLike = { from: (table: string) => any };

type StageRecord = {
  stage: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  metadata?: Record<string, unknown>;
  error?: string | null;
};

function warn(message: string, detail?: unknown) {
  console.warn(`[compilerStage] ${message}`, detail || "");
}

function durationMs(startedAt: string, finishedAt: string) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(finishedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function normalizeLegacyStage(job: Record<string, unknown> = {}) {
  const compilerStage = job.compiler_stage || job.compilerStage;
  if (compilerStage) return String(compilerStage);
  const legacy = job.stage || (job.stats as Record<string, unknown>)?.stage;
  if (!legacy) return null;
  return LEGACY_STAGE_MAP[String(legacy)] || String(legacy);
}

export function buildCompilerProfile({ knowledgeDomain, reportType }: { knowledgeDomain?: string; reportType?: string } = {}) {
  return `${String(knowledgeDomain || "unknown")}:${String(reportType || "other")}`;
}

async function readJobCompilerState(supabase: SupabaseLike, jobId: string) {
  const { data, error } = await supabase
    .from("ask_nac_ingestion_jobs")
    .select("compiler_stages, compilation_manifest, compiler_profile, compiler_version")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data || { compiler_stages: [], compilation_manifest: {} };
}

async function patchJobCompiler(supabase: SupabaseLike, jobId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("ask_nac_ingestion_jobs").update(patch).eq("id", jobId);
  if (error) warn("patch failed", error.message);
  return !error;
}

function appendStage(stages: StageRecord[], entry: StageRecord) {
  return [...(Array.isArray(stages) ? stages : []), entry];
}

function closeRunningStage(
  stages: StageRecord[],
  stageName: string,
  status: string,
  finishedAt: string,
  metadata: Record<string, unknown> = {},
  error: string | null = null,
) {
  const next = [...(Array.isArray(stages) ? stages : [])];
  let idx = -1;
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].stage === stageName && next[i].status === "running") {
      idx = i;
      break;
    }
  }
  if (idx >= 0) {
    const startedAt = next[idx].started_at;
    next[idx] = {
      ...next[idx],
      status,
      finished_at: finishedAt,
      duration_ms: durationMs(startedAt, finishedAt),
      metadata: { ...(next[idx].metadata || {}), ...metadata },
      error,
    };
    return next;
  }
  return appendStage(next, {
    stage: stageName,
    status,
    started_at: finishedAt,
    finished_at: finishedAt,
    duration_ms: 0,
    metadata,
    error,
  });
}

export async function startCompilerStage(
  supabase: SupabaseLike,
  jobId: string,
  stageName: string,
  metadata: Record<string, unknown> = {},
) {
  if (!supabase || !jobId || !stageName) return false;
  try {
    const startedAt = new Date().toISOString();
    const job = await readJobCompilerState(supabase, jobId);
    const compilerStages = appendStage((job.compiler_stages || []) as StageRecord[], {
      stage: stageName,
      status: "running",
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
      metadata,
      error: null,
    });
    return patchJobCompiler(supabase, jobId, {
      compiler_stage: stageName,
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compiler_stages: compilerStages,
    });
  } catch (err) {
    warn("startCompilerStage failed", (err as Error)?.message || err);
    return false;
  }
}

export async function completeCompilerStage(
  supabase: SupabaseLike,
  jobId: string,
  stageName: string,
  metadata: Record<string, unknown> = {},
) {
  if (!supabase || !jobId || !stageName) return false;
  try {
    const finishedAt = new Date().toISOString();
    const job = await readJobCompilerState(supabase, jobId);
    const compilerStages = closeRunningStage(
      (job.compiler_stages || []) as StageRecord[],
      stageName,
      "completed",
      finishedAt,
      metadata,
    );
    return patchJobCompiler(supabase, jobId, {
      compiler_stage: stageName,
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compiler_stages: compilerStages,
    });
  } catch (err) {
    warn("completeCompilerStage failed", (err as Error)?.message || err);
    return false;
  }
}

export async function failCompilerStage(
  supabase: SupabaseLike,
  jobId: string,
  stageName: string,
  error: string,
  metadata: Record<string, unknown> = {},
) {
  if (!supabase || !jobId || !stageName) return false;
  try {
    const finishedAt = new Date().toISOString();
    const job = await readJobCompilerState(supabase, jobId);
    const compilerStages = closeRunningStage(
      (job.compiler_stages || []) as StageRecord[],
      stageName,
      "failed",
      finishedAt,
      metadata,
      String(error || "unknown error"),
    );
    return patchJobCompiler(supabase, jobId, {
      compiler_stage: stageName,
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compiler_stages: compilerStages,
    });
  } catch (err) {
    warn("failCompilerStage failed", (err as Error)?.message || err);
    return false;
  }
}

export async function setCompilerManifest(
  supabase: SupabaseLike,
  jobId: string,
  manifestPatch: Record<string, unknown> = {},
) {
  if (!supabase || !jobId || !manifestPatch) return false;
  try {
    const job = await readJobCompilerState(supabase, jobId);
    const compilationManifest = {
      ...((job.compilation_manifest || {}) as Record<string, unknown>),
      ...manifestPatch,
    };
    return patchJobCompiler(supabase, jobId, {
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compilation_manifest: compilationManifest,
    });
  } catch (err) {
    warn("setCompilerManifest failed", (err as Error)?.message || err);
    return false;
  }
}

export async function initializeCompilerJobObservability(
  supabase: SupabaseLike,
  jobId: string,
  { compilerProfile }: { compilerProfile?: string } = {},
) {
  if (!supabase || !jobId) return false;
  try {
    return patchJobCompiler(supabase, jobId, {
      compiler_profile: compilerProfile || null,
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compiler_stage: null,
      compiler_stages: [],
      compilation_manifest: {},
    });
  } catch (err) {
    warn("initializeCompilerJobObservability failed", (err as Error)?.message || err);
    return false;
  }
}

export function summarizeCompilerStageDiagnostics(jobs: Array<Record<string, unknown>> = []) {
  const byCompilerStage: Record<string, number> = {};
  const failedStages: Array<Record<string, unknown>> = [];
  const latestStageDurations: Array<Record<string, unknown>> = [];

  for (const job of jobs) {
    const current = String(job.compiler_stage || normalizeLegacyStage(job) || "unknown");
    byCompilerStage[current] = (byCompilerStage[current] || 0) + 1;
    for (const stage of (job.compiler_stages as Array<Record<string, unknown>>) || []) {
      if (stage.status === "failed") {
        failedStages.push({
          jobId: job.id,
          stage: stage.stage,
          error: stage.error || job.error || null,
          reportType: job.reportType || null,
        });
      }
      if (stage.duration_ms != null && stage.status === "completed") {
        latestStageDurations.push({
          stage: stage.stage,
          durationMs: stage.duration_ms,
          jobId: job.id,
        });
      }
    }
  }

  latestStageDurations.sort((a, b) => Number(b.durationMs) - Number(a.durationMs));

  return {
    jobCount: jobs.length,
    jobsWithCompilerStages: jobs.filter((j) => ((j.compiler_stages as unknown[]) || []).length > 0).length,
    byCompilerStage,
    failedStages: failedStages.slice(0, 12),
    latestStageDurations: latestStageDurations.slice(0, 12),
  };
}
