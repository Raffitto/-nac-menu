export type DatasetFreshness = {
  source: string;
  dataset: string;
  branchId: string;
  dataThrough: string | null;
  completeThrough: string | null;
  lastSuccessAt: string | null;
  status: "ready" | "stale" | "waiting_for_companion" | "delayed" | "warning" | "failed" | "unavailable";
  sourceMode: string | null;
  quality: Record<string, unknown>;
};

export type CoverageWindow = {
  dataset: string;
  through: string | null;
};

export function intersectCoverage(windows: CoverageWindow[]): {
  commonThrough: string | null;
  mismatched: boolean;
  latest: string | null;
} {
  const dates = windows.map((w) => w.through).filter((d): d is string => Boolean(d));
  if (!dates.length) return { commonThrough: null, mismatched: windows.length > 0, latest: null };
  const sorted = [...dates].sort();
  return {
    commonThrough: sorted[0],
    latest: sorted[sorted.length - 1],
    mismatched: sorted[0] !== sorted[sorted.length - 1],
  };
}

export function freshnessStatus(input: {
  dataThrough: string | null;
  asOf: string;
  slaHours: number;
  lastSuccessAt: string | null;
  waitingCompanion?: boolean;
  failed?: boolean;
}): DatasetFreshness["status"] {
  if (input.failed) return "failed";
  if (input.waitingCompanion) return "waiting_for_companion";
  if (!input.dataThrough) return "unavailable";
  const asOf = Date.parse(`${input.asOf}T12:00:00.000Z`);
  const through = Date.parse(`${input.dataThrough}T12:00:00.000Z`);
  if (Number.isFinite(asOf) && Number.isFinite(through) && asOf - through > 36 * 3600 * 1000) {
    return "stale";
  }
  if (input.lastSuccessAt) {
    const age = Date.now() - Date.parse(input.lastSuccessAt);
    if (age > input.slaHours * 3600 * 1000) return "delayed";
  }
  return "ready";
}
