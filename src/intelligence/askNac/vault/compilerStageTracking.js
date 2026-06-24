/**
 * Compiler stage observability — non-blocking writes to ask_nac_ingestion_jobs.
 */

export const COMPILER_OBSERVABILITY_VERSION = "compiler-observability-v0";

const LEGACY_STAGE_MAP = Object.freeze({
  parse: "legacy_parse",
  extract: "legacy_parse",
  persist: "publish",
  registry_only: "classify",
  chunks_indexed: "legacy_chunk",
  drive_ingest: "legacy_drive_ingest",
  raw_extract_only: "legacy_parse",
  facts_published: "publish",
  facts_published_with_warnings: "publish",
});

function warn(message, detail) {
  if (typeof console !== "undefined" && console.warn) {
    console.warn(`[compilerStage] ${message}`, detail || "");
  }
}

function durationMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt || "");
  const end = Date.parse(finishedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

export function normalizeLegacyStage(job = {}) {
  const compilerStage = job.compiler_stage || job.compilerStage;
  if (compilerStage) return compilerStage;
  const legacy = job.stage || job.stats?.stage;
  if (!legacy) return null;
  return LEGACY_STAGE_MAP[legacy] || legacy;
}

export function buildCompilerProfile({ knowledgeDomain, reportType } = {}) {
  const domain = String(knowledgeDomain || "unknown");
  const type = String(reportType || "other");
  return `${domain}:${type}`;
}

async function readJobCompilerState(supabase, jobId) {
  const { data, error } = await supabase
    .from("ask_nac_ingestion_jobs")
    .select("compiler_stages, compilation_manifest, compiler_profile, compiler_version")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data || { compiler_stages: [], compilation_manifest: {} };
}

async function patchJobCompiler(supabase, jobId, patch) {
  const { error } = await supabase.from("ask_nac_ingestion_jobs").update(patch).eq("id", jobId);
  if (error) warn("patch failed", error.message);
  return !error;
}

function appendStage(stages, entry) {
  return [...(Array.isArray(stages) ? stages : []), entry];
}

function closeRunningStage(stages, stageName, status, finishedAt, metadata = {}, error = null) {
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
      error: error || null,
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
    error: error || null,
  });
}

export async function startCompilerStage(supabase, jobId, stageName, metadata = {}) {
  if (!supabase || !jobId || !stageName) return false;
  try {
    const startedAt = new Date().toISOString();
    const job = await readJobCompilerState(supabase, jobId);
    const compilerStages = appendStage(job.compiler_stages, {
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
    warn("startCompilerStage failed", err?.message || err);
    return false;
  }
}

export async function completeCompilerStage(supabase, jobId, stageName, metadata = {}) {
  if (!supabase || !jobId || !stageName) return false;
  try {
    const finishedAt = new Date().toISOString();
    const job = await readJobCompilerState(supabase, jobId);
    const compilerStages = closeRunningStage(job.compiler_stages, stageName, "completed", finishedAt, metadata);
    return patchJobCompiler(supabase, jobId, {
      compiler_stage: stageName,
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compiler_stages: compilerStages,
    });
  } catch (err) {
    warn("completeCompilerStage failed", err?.message || err);
    return false;
  }
}

export async function failCompilerStage(supabase, jobId, stageName, error, metadata = {}) {
  if (!supabase || !jobId || !stageName) return false;
  try {
    const finishedAt = new Date().toISOString();
    const job = await readJobCompilerState(supabase, jobId);
    const compilerStages = closeRunningStage(
      job.compiler_stages,
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
    warn("failCompilerStage failed", err?.message || err);
    return false;
  }
}

export async function setCompilerManifest(supabase, jobId, manifestPatch = {}) {
  if (!supabase || !jobId || !manifestPatch || typeof manifestPatch !== "object") return false;
  try {
    const job = await readJobCompilerState(supabase, jobId);
    const compilationManifest = {
      ...(job.compilation_manifest && typeof job.compilation_manifest === "object" ? job.compilation_manifest : {}),
      ...manifestPatch,
    };
    return patchJobCompiler(supabase, jobId, {
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compilation_manifest: compilationManifest,
    });
  } catch (err) {
    warn("setCompilerManifest failed", err?.message || err);
    return false;
  }
}

export async function initializeCompilerJobObservability(
  supabase,
  jobId,
  { compilerProfile, metadata = {} } = {},
) {
  if (!supabase || !jobId) return false;
  try {
    return patchJobCompiler(supabase, jobId, {
      compiler_profile: compilerProfile || null,
      compiler_version: COMPILER_OBSERVABILITY_VERSION,
      compiler_stage: null,
      compiler_stages: [],
      compilation_manifest: {},
      ...(metadata.initialManifest ? { compilation_manifest: metadata.initialManifest } : {}),
    });
  } catch (err) {
    warn("initializeCompilerJobObservability failed", err?.message || err);
    return false;
  }
}
