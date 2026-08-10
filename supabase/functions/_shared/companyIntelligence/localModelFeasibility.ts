/**
 * Local hardware feasibility notes for Apple Silicon lab use only.
 * No download / no production dependency.
 */

export type LocalModelCandidate = {
  id: string;
  family: string;
  role: "reasoner" | "router";
  quantization: string;
  approxDiskGb: number;
  approxRamGb: number;
  activeParamsNote: string;
  fitsM2Max32Gb: "likely" | "tight" | "unlikely" | "unknown";
  downloadInThisTask: boolean;
  notes: string;
};

/**
 * Architectural estimates from public MLX / community fit data (not measured here).
 * M2 Max 32GB usable headroom is materially less than 32GB after macOS + Cursor.
 */
export const LOCAL_MODEL_CANDIDATES: LocalModelCandidate[] = [
  {
    id: "qwen3-30b-a3b-mlx-4bit",
    family: "Qwen3 30B-A3B (MoE)",
    role: "reasoner",
    quantization: "MLX 4-bit",
    approxDiskGb: 17,
    approxRamGb: 17,
    activeParamsNote: "~3B active / ~30B total experts resident in memory",
    fitsM2Max32Gb: "tight",
    downloadInThisTask: false,
    notes:
      "Promising local reasoner for lab benchmarks via MLX/LM Studio. Do not download in this foundation task (~17GB). Prefer company inference host later.",
  },
  {
    id: "gpt-oss-20b-mxfp4",
    family: "GPT-OSS 20B",
    role: "reasoner",
    quantization: "MXFP4 / Q4",
    approxDiskGb: 12,
    approxRamGb: 12,
    activeParamsNote: "Dense-ish 20B class; memory tracks weights + KV",
    fitsM2Max32Gb: "likely",
    downloadInThisTask: false,
    notes:
      "Smaller footprint than Qwen3-30B-A3B. Still not downloaded here — architecture must not depend on local binary.",
  },
  {
    id: "qwen3-1.7b-mlx",
    family: "Qwen3 1.7B",
    role: "router",
    quantization: "MLX bf16 / 4-bit",
    approxDiskGb: 4,
    approxRamGb: 4.5,
    activeParamsNote: "Tiny dense router/extractor",
    fitsM2Max32Gb: "likely",
    downloadInThisTask: false,
    notes:
      "Optional future Tier-1 local router. Skipped download to conserve disk/quota; OpenAI-compatible adapter is ready.",
  },
];

export function localModelDownloadDecision(): {
  downloaded: boolean;
  reason: string;
  preferredRuntime: "mlx" | "ollama" | "none";
  preferredCandidateId: string | null;
} {
  return {
    downloaded: false,
    reason:
      "Disk/RAM impact of promising reasoners (~12–17GB+) is unjustified for a contracts-only foundation phase; adapter path is provider-neutral.",
    preferredRuntime: "mlx",
    preferredCandidateId: "gpt-oss-20b-mxfp4",
  };
}
