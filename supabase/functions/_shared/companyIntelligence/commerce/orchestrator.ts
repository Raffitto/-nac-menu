import { getDataset, type AcquisitionMode } from "./datasetRegistry.ts";
import { detectAcquisitionMode } from "./exportRequests.ts";
import { applyPublicationEvent, canPublishSessions, type PublicationGroup } from "./publication.ts";
import { planCompletedDayAcquisition } from "./acquisitionEngine.ts";

export type AcquireDecision =
  | { action: "ingest_direct" }
  | { action: "wait_async" }
  | { action: "retry" }
  | { action: "use_read_fallback" }
  | { action: "keep_previous_snapshot" }
  | { action: "wait_companion" }
  | { action: "publish" };

export function decideAcquisition(input: {
  dataset: string;
  detected: ReturnType<typeof detectAcquisitionMode>;
  asyncAgeHours?: number;
  retryCount?: number;
  fallbackSucceeded?: boolean;
  fallbackSupported?: boolean;
}): AcquireDecision {
  const entry = getDataset(input.dataset);
  const sla = entry?.freshnessSlaHours ?? 36;
  if (input.detected === "direct_download") return { action: "ingest_direct" };
  if (input.detected === "async_email") {
    if ((input.asyncAgeHours || 0) < sla) return { action: "wait_async" };
    if ((input.retryCount || 0) < 2) return { action: "retry" };
    if (input.fallbackSupported) return { action: "use_read_fallback" };
    return { action: "keep_previous_snapshot" };
  }
  if (input.fallbackSupported) return { action: "use_read_fallback" };
  return { action: "keep_previous_snapshot" };
}

export function decidePublication(group: PublicationGroup): AcquireDecision {
  if (!group.ordersBatchId || !group.itemsBatchId) return { action: "wait_companion" };
  if (canPublishSessions(applyPublicationEvent(group, "quality_passed"))) return { action: "publish" };
  return { action: "wait_companion" };
}

export function nightlyWindows(input: {
  asOf: string;
  latestCompleted: string;
  overlapDays?: number;
}): Array<{ start: string; end: string }> {
  const overlap = input.overlapDays ?? 3;
  const end = input.latestCompleted;
  const startDate = new Date(`${end}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - (overlap - 1));
  return [{ start: startDate.toISOString().slice(0, 10), end }];
}

export function nightlyCatchupDates(input: {
  asOf: string;
  publishedDates: string[];
  watermark?: string | null;
  epochStart?: string | null;
  openGaps?: string[];
}): string[] {
  return planCompletedDayAcquisition({
    asOf: input.asOf,
    publishedDates: input.publishedDates,
    watermark: input.watermark,
    epochStart: input.epochStart,
    openGaps: input.openGaps,
    requestedSource: "scheduler",
  }).datesOldestFirst;
}

export function backfillChunks(from: string, to: string): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let cursor = new Date(`${from}T00:00:00.000Z`);
  const last = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= last) {
    const start = cursor.toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const end = (monthEnd < last ? monthEnd : last).toISOString().slice(0, 10);
    chunks.push({ start, end });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return chunks;
}

export function allowedFallback(dataset: string, mode: AcquisitionMode): boolean {
  const entry = getDataset(dataset);
  return Boolean(entry?.fallbackModes.includes(mode));
}
