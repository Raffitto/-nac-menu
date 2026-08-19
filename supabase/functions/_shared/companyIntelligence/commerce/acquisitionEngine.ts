/**
 * Authenticated Foodics completed-day acquisition.
 * Production path: list + per-order detail → validate → canonicalize → publish.
 * Official async export is out of band (BLOCKED_EXTERNAL_DEPENDENCY).
 */

import {
  addCalendarDays,
  compareIsoDates,
  dateRangeInclusive,
  isCurrentRiyadhBusinessDate,
  isNightlySchedulerWindow,
  isSafeCompletedDate,
  newestSafeCompletedDate,
  riyadhCalendarDate,
  riyadhOffsetTimestamp,
} from "./acquisitionCalendar.ts";
import {
  buildAcquisitionEvidence,
  checksumRawDetails,
  type AcquisitionEvidenceRecord,
  type AcquisitionInvocationSource,
  type IdempotencyResult,
} from "./acquisitionEvidence.ts";
import { adaptFoodicsConsoleOrder } from "./foodicsAdapter.ts";
import { duplicateRate, joinRate, upsertItems, upsertOrders } from "./idempotency.ts";
import { COMMERCE_DERIVATION_VERSION } from "./lineage.ts";
import { buildDineInSessions } from "./metrics.ts";
import { evaluatePublicationQuality } from "./publication.ts";
import {
  applyQualifiedProofResult,
  defaultProofState,
  type ProofState,
} from "./proofRetention.ts";
import type { CanonicalOrder, CanonicalOrderItem, DineInSession } from "./types.ts";

export type AcquisitionRunState =
  | "DISCOVERED"
  | "ACQUIRING"
  | "ACQUIRE_FAILED"
  | "INTERRUPTED"
  | "VALIDATED"
  | "VALIDATE_FAILED"
  | "CANONICALIZED"
  | "CANONICALIZE_FAILED"
  | "PUBLISHED"
  | "PUBLISH_FAILED"
  | "IDEMPOTENT_NOOP";

const RETRYABLE: AcquisitionRunState[] = [
  "DISCOVERED",
  "ACQUIRING",
  "ACQUIRE_FAILED",
  "INTERRUPTED",
  "VALIDATE_FAILED",
  "CANONICALIZE_FAILED",
  "PUBLISH_FAILED",
];

const LEGAL_TRANSITIONS: Record<AcquisitionRunState, AcquisitionRunState[]> = {
  DISCOVERED: ["ACQUIRING", "IDEMPOTENT_NOOP", "INTERRUPTED"],
  ACQUIRING: ["VALIDATED", "ACQUIRE_FAILED", "INTERRUPTED", "VALIDATE_FAILED"],
  ACQUIRE_FAILED: ["ACQUIRING", "INTERRUPTED"],
  INTERRUPTED: ["ACQUIRING", "DISCOVERED"],
  VALIDATED: ["CANONICALIZED", "CANONICALIZE_FAILED", "INTERRUPTED"],
  VALIDATE_FAILED: ["ACQUIRING", "INTERRUPTED"],
  CANONICALIZED: ["PUBLISHED", "PUBLISH_FAILED", "INTERRUPTED"],
  CANONICALIZE_FAILED: ["ACQUIRING", "VALIDATED", "INTERRUPTED"],
  PUBLISHED: ["IDEMPOTENT_NOOP"],
  PUBLISH_FAILED: ["CANONICALIZED", "ACQUIRING", "INTERRUPTED"],
  IDEMPOTENT_NOOP: ["IDEMPOTENT_NOOP"],
};

export function canTransition(from: AcquisitionRunState, to: AcquisitionRunState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isRetryableState(state: AcquisitionRunState): boolean {
  return RETRYABLE.includes(state);
}

export function isQualifiedSuccessState(state: AcquisitionRunState): boolean {
  return state === "PUBLISHED";
}

export type FoodicsListing = {
  orderIds: string[];
  listingCount: number;
};

export type FoodicsAuthenticatedSource = {
  listOrders(input: { branchId: string; businessDate: string }): Promise<FoodicsListing>;
  fetchOrderDetail(input: { orderId: string; branchId: string; businessDate: string }): Promise<unknown>;
};

export type PublishedDayRecord = {
  businessDate: string;
  listingCount: number;
  listingChecksum: string;
  rawChecksum: string;
  orderCount: number;
  itemCount: number;
  sessionCount: number;
  runId: string;
};

export type AcquisitionRun = {
  runId: string;
  branchId: string;
  businessDate: string;
  state: AcquisitionRunState;
  invocationSource: AcquisitionInvocationSource;
  listedOrderIds: string[];
  pendingOrderIds: string[];
  fetchedDetails: unknown[];
  failedOrderIds: string[];
  listingCount: number;
  fetchedDetailCount: number;
  error: string | null;
  retryable: boolean;
};

export type CanonicalDayBundle = {
  orders: CanonicalOrder[];
  items: CanonicalOrderItem[];
  sessions: DineInSession[];
};

export type AcquisitionStore = {
  getPublishedDates(branchId: string): string[];
  getWatermark(branchId: string): string | null;
  getOpenGaps(branchId: string): string[];
  getPublishedDay(branchId: string, businessDate: string): PublishedDayRecord | null;
  getRun(branchId: string, businessDate: string): AcquisitionRun | null;
  saveRun(run: AcquisitionRun): void;
  publish(input: {
    branchId: string;
    businessDate: string;
    bundle: CanonicalDayBundle;
    record: PublishedDayRecord;
  }): { previousWatermark: string | null; newWatermark: string };
  persistEvidence(evidence: AcquisitionEvidenceRecord): void;
  getEvidence(runId: string): AcquisitionEvidenceRecord | null;
  listEvidence(branchId: string): AcquisitionEvidenceRecord[];
  getProofState(): ProofState;
  setProofState(state: ProofState): void;
  getCanonical(branchId: string, businessDate: string): CanonicalDayBundle | null;
};

export type ScriptedFoodicsSource = FoodicsAuthenticatedSource & {
  detailCalls: string[];
  listCalls: string[];
};

export function createScriptedFoodicsSource(script: {
  ordersByDate: Record<string, unknown[]>;
  failDetailIds?: string[];
  failDetailOnce?: string[];
  interruptAfter?: number;
  malformedById?: Record<string, unknown>;
}): ScriptedFoodicsSource {
  const failOnce = new Set(script.failDetailOnce || []);
  const failAlways = new Set(script.failDetailIds || []);
  const detailCalls: string[] = [];
  const listCalls: string[] = [];
  return {
    detailCalls,
    listCalls,
    async listOrders({ businessDate }) {
      listCalls.push(businessDate);
      const rows = script.ordersByDate[businessDate] || [];
      const orderIds = rows.map((row) => String((row as { id?: unknown }).id || ""));
      return { orderIds, listingCount: orderIds.length };
    },
    async fetchOrderDetail({ orderId }) {
      detailCalls.push(orderId);
      if (script.interruptAfter != null && detailCalls.length > script.interruptAfter) {
        throw Object.assign(new Error("interrupted"), { name: "ACQUISITION_INTERRUPTED" });
      }
      if (failAlways.has(orderId)) throw new Error(`detail_failed:${orderId}`);
      if (failOnce.has(orderId)) {
        failOnce.delete(orderId);
        throw new Error(`detail_failed_once:${orderId}`);
      }
      if (script.malformedById && orderId in script.malformedById) {
        return script.malformedById[orderId];
      }
      for (const rows of Object.values(script.ordersByDate)) {
        const hit = rows.find((row) => String((row as { id?: unknown }).id || "") === orderId);
        if (hit) return hit;
      }
      throw new Error(`detail_missing:${orderId}`);
    },
  };
}

export function createMemoryAcquisitionStore(seed: {
  published?: PublishedDayRecord[];
  watermark?: string | null;
  proofState?: ProofState;
} = {}): AcquisitionStore {
  const published = new Map<string, PublishedDayRecord>();
  const canonical = new Map<string, CanonicalDayBundle>();
  const runs = new Map<string, AcquisitionRun>();
  const evidence = new Map<string, AcquisitionEvidenceRecord>();
  let watermark = seed.watermark ?? null;
  let proofState = seed.proofState || defaultProofState();
  for (const row of seed.published || []) {
    published.set(row.businessDate, row);
  }
  if (seed.watermark != null) watermark = seed.watermark;
  else watermark = contiguousCompleteThrough([...published.keys()]);
  const key = (branchId: string, date: string) => `${branchId}:${date}`;
  return {
    getPublishedDates() {
      return [...published.keys()].sort();
    },
    getWatermark() {
      return watermark;
    },
    getOpenGaps() {
      return [...runs.values()]
        .filter((run) => run.state !== "PUBLISHED" && run.state !== "IDEMPOTENT_NOOP")
        .map((run) => run.businessDate)
        .sort();
    },
    getPublishedDay(_branchId, businessDate) {
      return published.get(businessDate) || null;
    },
    getRun(branchId, businessDate) {
      return runs.get(key(branchId, businessDate)) || null;
    },
    saveRun(run) {
      runs.set(key(run.branchId, run.businessDate), { ...run, fetchedDetails: [...run.fetchedDetails] });
    },
    publish({ businessDate, bundle, record }) {
      const previousWatermark = watermark;
      published.set(businessDate, record);
      canonical.set(businessDate, {
        orders: [...bundle.orders],
        items: [...bundle.items],
        sessions: [...bundle.sessions],
      });
      watermark = contiguousCompleteThrough([...published.keys()]);
      return { previousWatermark, newWatermark: watermark };
    },
    persistEvidence(row) {
      evidence.set(row.runId, row);
    },
    getEvidence(runId) {
      return evidence.get(runId) || null;
    },
    listEvidence() {
      return [...evidence.values()];
    },
    getProofState() {
      return proofState;
    },
    setProofState(next) {
      proofState = next;
    },
    getCanonical(_branchId, businessDate) {
      return canonical.get(businessDate) || null;
    },
  };
}

export type CatchupPlan = {
  asOf: string;
  currentRiyadhDate: string;
  newestSafeCompletedDate: string;
  watermark: string | null;
  invocationSource: AcquisitionInvocationSource;
  datesOldestFirst: string[];
};

export function contiguousCompleteThrough(publishedDates: string[]): string | null {
  const sorted = [...new Set(publishedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!sorted.length) return null;
  let through = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== addCalendarDays(through, 1)) break;
    through = sorted[i];
  }
  return through;
}

export function detectMissingCompletedDates(input: {
  asOf: Date | string;
  publishedDates: string[];
  watermark?: string | null;
  epochStart?: string | null;
  openGaps?: string[];
}): string[] {
  const newestSafe = newestSafeCompletedDate(input.asOf);
  const published = new Set(input.publishedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  const watermark = input.watermark || contiguousCompleteThrough([...published]);
  let from: string;
  if (input.epochStart) from = input.epochStart;
  else if (watermark) from = addCalendarDays(watermark, 1);
  else from = newestSafe;
  const ranged = compareIsoDates(from, newestSafe) > 0 ? [] : dateRangeInclusive(from, newestSafe);
  const union = [...new Set([...(input.openGaps || []), ...ranged])].sort();
  return union.filter((date) => {
    if (isCurrentRiyadhBusinessDate(date, input.asOf)) return false;
    if (!isSafeCompletedDate(date, input.asOf)) return false;
    return !published.has(date);
  });
}

export function resolveInvocationSource(input: {
  requested?: AcquisitionInvocationSource | null;
  gapCount: number;
  asOf: Date | string;
}): AcquisitionInvocationSource {
  if (input.requested) return input.requested;
  if (input.gapCount > 1) return "catch-up";
  if (isNightlySchedulerWindow(input.asOf)) return "scheduler";
  return "manual";
}

export function planSchedulerCatchup(input: {
  asOf: Date | string;
  publishedDates: string[];
  watermark?: string | null;
  epochStart?: string | null;
  openGaps?: string[];
  requestedSource?: AcquisitionInvocationSource | null;
}): CatchupPlan {
  const datesOldestFirst = detectMissingCompletedDates(input);
  const asOf = typeof input.asOf === "string" ? input.asOf : input.asOf.toISOString();
  return {
    asOf,
    currentRiyadhDate: riyadhCalendarDate(input.asOf),
    newestSafeCompletedDate: newestSafeCompletedDate(input.asOf),
    watermark: input.watermark || contiguousCompleteThrough(input.publishedDates),
    invocationSource: resolveInvocationSource({
      requested: input.requestedSource,
      gapCount: datesOldestFirst.length,
      asOf: input.asOf,
    }),
    datesOldestFirst,
  };
}

export function planCompletedDayAcquisition(input: Parameters<typeof planSchedulerCatchup>[0]): CatchupPlan {
  return planSchedulerCatchup(input);
}

function transition(run: AcquisitionRun, next: AcquisitionRunState, error: string | null = null): AcquisitionRun {
  if (!canTransition(run.state, next)) {
    throw new Error(`illegal_transition:${run.state}->${next}`);
  }
  return {
    ...run,
    state: next,
    error,
    retryable: isRetryableState(next),
  };
}

function emptyRun(input: {
  runId: string;
  branchId: string;
  businessDate: string;
  invocationSource: AcquisitionInvocationSource;
}): AcquisitionRun {
  return {
    runId: input.runId,
    branchId: input.branchId,
    businessDate: input.businessDate,
    state: "DISCOVERED",
    invocationSource: input.invocationSource,
    listedOrderIds: [],
    pendingOrderIds: [],
    fetchedDetails: [],
    failedOrderIds: [],
    listingCount: 0,
    fetchedDetailCount: 0,
    error: null,
    retryable: true,
  };
}

function listingChecksum(orderIds: string[]): Promise<string> {
  return checksumRawDetails(orderIds.map((id) => ({ id })));
}

function asRawOrder(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== "object") {
    const err = new Error("malformed_foodics_detail");
    err.name = "FOODICS_SCHEMA_DRIFT";
    throw err;
  }
  const rec = detail as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object") return rec.data as Record<string, unknown>;
  return rec;
}

export function gateAuthenticatedListing(input: {
  listingCount: number;
  fetchedDetailCount: number;
  failedCount: number;
  malformedCount: number;
  duplicateIds: number;
}): { ok: boolean; errors: string[]; zeroOrderDay: boolean } {
  const errors: string[] = [];
  const zeroOrderDay = input.listingCount === 0 && input.fetchedDetailCount === 0 && input.failedCount === 0;
  if (input.duplicateIds > 0) errors.push("duplicate_source_ids");
  if (input.malformedCount > 0) errors.push("malformed_source_response");
  if (input.failedCount > 0) errors.push("partial_detail_fetch");
  if (input.listingCount > 0 && input.fetchedDetailCount !== input.listingCount) {
    errors.push("listing_detail_mismatch");
  }
  if (zeroOrderDay) return { ok: true, errors: [], zeroOrderDay: true };
  return { ok: errors.length === 0, errors, zeroOrderDay: false };
}

function canonicalizeDetails(
  details: unknown[],
  ingestedAt: string,
): { bundle: CanonicalDayBundle; malformedCount: number } {
  const orders: CanonicalOrder[] = [];
  const items: CanonicalOrderItem[] = [];
  let malformedCount = 0;
  for (const detail of details) {
    try {
      const adapted = adaptFoodicsConsoleOrder(asRawOrder(detail), [], ingestedAt);
      orders.push(adapted.order);
      items.push(...adapted.items);
    } catch {
      malformedCount += 1;
    }
  }
  const uniqueOrders = upsertOrders([], orders);
  const uniqueItems = upsertItems([], items);
  return {
    bundle: {
      orders: uniqueOrders,
      items: uniqueItems,
      sessions: buildDineInSessions(uniqueOrders, uniqueItems),
    },
    malformedCount,
  };
}

export type DateAcquisitionResult = {
  run: AcquisitionRun;
  evidence: AcquisitionEvidenceRecord;
  idempotencyResult: IdempotencyResult;
  previousWatermark: string | null;
  newWatermark: string | null;
};

async function verifyPublishedDay(
  source: FoodicsAuthenticatedSource,
  store: AcquisitionStore,
  input: {
    branchId: string;
    businessDate: string;
    published: PublishedDayRecord;
    invocationSource: AcquisitionInvocationSource;
    runId: string;
    startedAt: Date;
    completedAt: Date;
  },
): Promise<DateAcquisitionResult> {
  const listing = await source.listOrders({ branchId: input.branchId, businessDate: input.businessDate });
  const listedChecksum = await listingChecksum(listing.orderIds);
  const match = listedChecksum === input.published.listingChecksum
    && listing.listingCount === input.published.listingCount;
  const idempotencyResult: IdempotencyResult = match ? "noop_verified" : "noop_integrity_mismatch";
  let run = emptyRun({
    runId: input.runId,
    branchId: input.branchId,
    businessDate: input.businessDate,
    invocationSource: input.invocationSource,
  });
  run.listedOrderIds = listing.orderIds;
  run.listingCount = listing.listingCount;
  run.fetchedDetailCount = input.published.orderCount;
  run = transition(run, "IDEMPOTENT_NOOP", match ? null : "integrity_mismatch");
  store.saveRun(run);
  const canonical = store.getCanonical(input.branchId, input.businessDate);
  const evidence = buildAcquisitionEvidence({
    runId: input.runId,
    invocationSource: input.invocationSource,
    riyadhStartedAt: riyadhOffsetTimestamp(input.startedAt),
    riyadhCompletedAt: riyadhOffsetTimestamp(input.completedAt),
    targetBusinessDate: input.businessDate,
    branchId: input.branchId,
    acquisitionMethod: "authenticated_read",
    listingCount: listing.listingCount,
    fetchedDetailCount: input.published.orderCount,
    itemCount: input.published.itemCount,
    rawChecksums: {
      listing: listedChecksum,
      rawBatch: input.published.rawChecksum,
    },
    canonicalOrderCount: canonical?.orders.length ?? input.published.orderCount,
    canonicalItemCount: canonical?.items.length ?? input.published.itemCount,
    canonicalSessionCount: canonical?.sessions.length ?? input.published.sessionCount,
    previousWatermark: store.getWatermark(input.branchId),
    newWatermark: store.getWatermark(input.branchId),
    publicationDestination: "commerce_orders+commerce_order_items+commerce_sessions",
    publicationVersion: COMMERCE_DERIVATION_VERSION,
    idempotencyResult,
    finalState: run.state,
    qualified: false,
    liveListCount: listing.listingCount,
    liveDetailCalls: 0,
    representativeOrderId: listing.orderIds[0] || null,
    rawBytes: listing.listingCount,
    ingestOk: true,
    validationPass: true,
    publicationOk: true,
    sourceCompleted: true,
  });
  store.persistEvidence(evidence);
  return {
    run,
    evidence,
    idempotencyResult,
    previousWatermark: store.getWatermark(input.branchId),
    newWatermark: store.getWatermark(input.branchId),
  };
}

export async function acquireCompletedBusinessDate(input: {
  branchId: string;
  businessDate: string;
  asOf: Date | string;
  source: FoodicsAuthenticatedSource;
  store: AcquisitionStore;
  invocationSource: AcquisitionInvocationSource;
  runId?: string;
  now?: Date | string;
  interrupt?: boolean;
}): Promise<DateAcquisitionResult> {
  const now = input.now ? (input.now instanceof Date ? input.now : new Date(input.now)) : new Date();
  const startedAt = now;
  const runId = input.runId || `acq_${input.branchId}_${input.businessDate}_${startedAt.toISOString()}`;
  if (isCurrentRiyadhBusinessDate(input.businessDate, input.asOf) || !isSafeCompletedDate(input.businessDate, input.asOf)) {
    const run = {
      ...emptyRun({
        runId,
        branchId: input.branchId,
        businessDate: input.businessDate,
        invocationSource: input.invocationSource,
      }),
      state: "VALIDATE_FAILED" as const,
      error: "current_riyadh_date_excluded",
      retryable: false,
    };
    const evidence = buildAcquisitionEvidence({
      runId,
      invocationSource: input.invocationSource,
      riyadhStartedAt: riyadhOffsetTimestamp(startedAt),
      riyadhCompletedAt: riyadhOffsetTimestamp(now),
      targetBusinessDate: input.businessDate,
      branchId: input.branchId,
      acquisitionMethod: "authenticated_read",
      listingCount: 0,
      fetchedDetailCount: 0,
      itemCount: 0,
      rawChecksums: {},
      canonicalOrderCount: 0,
      canonicalItemCount: 0,
      canonicalSessionCount: 0,
      previousWatermark: input.store.getWatermark(input.branchId),
      newWatermark: input.store.getWatermark(input.branchId),
      publicationDestination: "commerce_orders+commerce_order_items+commerce_sessions",
      publicationVersion: COMMERCE_DERIVATION_VERSION,
      idempotencyResult: "not_applicable",
      finalState: run.state,
      qualified: false,
      sourceCompleted: false,
      liveListCount: 0,
      liveDetailCalls: 0,
      representativeOrderId: null,
      rawBytes: 0,
      ingestOk: false,
      validationPass: false,
      publicationOk: false,
    });
    input.store.saveRun(run);
    input.store.persistEvidence(evidence);
    return {
      run,
      evidence,
      idempotencyResult: "not_applicable",
      previousWatermark: input.store.getWatermark(input.branchId),
      newWatermark: input.store.getWatermark(input.branchId),
    };
  }

  const published = input.store.getPublishedDay(input.branchId, input.businessDate);
  if (published) {
    return verifyPublishedDay(input.source, input.store, {
      branchId: input.branchId,
      businessDate: input.businessDate,
      published,
      invocationSource: input.invocationSource,
      runId,
      startedAt,
      completedAt: now,
    });
  }

  let run = input.store.getRun(input.branchId, input.businessDate);
  if (!run || !isRetryableState(run.state)) {
    run = emptyRun({
      runId,
      branchId: input.branchId,
      businessDate: input.businessDate,
      invocationSource: input.invocationSource,
    });
  } else {
    run = { ...run, runId, invocationSource: input.invocationSource };
  }

  if (run.state === "DISCOVERED" || run.state === "INTERRUPTED" || run.state === "ACQUIRE_FAILED" || run.state === "VALIDATE_FAILED") {
    run = run.state === "DISCOVERED" ? transition(run, "ACQUIRING") : { ...run, state: "ACQUIRING", retryable: true, error: null };
  }

  try {
    const listing = await input.source.listOrders({
      branchId: input.branchId,
      businessDate: input.businessDate,
    });
    const uniqueIds = [...new Set(listing.orderIds.filter(Boolean))];
    run.listedOrderIds = uniqueIds;
    run.listingCount = uniqueIds.length;
    const already = new Set(
      run.fetchedDetails.map((row) => String((asRawOrder(row) as { id?: unknown }).id || "")).filter(Boolean),
    );
    run.pendingOrderIds = uniqueIds.filter((id) => !already.has(id));
    run.failedOrderIds = [];
    for (const orderId of [...run.pendingOrderIds]) {
      if (input.interrupt) {
        run = { ...run, state: "INTERRUPTED", error: "interrupted", retryable: true };
        input.store.saveRun(run);
        break;
      }
      try {
        const detail = await input.source.fetchOrderDetail({
          orderId,
          branchId: input.branchId,
          businessDate: input.businessDate,
        });
        run.fetchedDetails.push(detail);
        run.pendingOrderIds = run.pendingOrderIds.filter((id) => id !== orderId);
        run.fetchedDetailCount = run.fetchedDetails.length;
        input.store.saveRun(run);
      } catch (err) {
        if ((err as { name?: string }).name === "ACQUISITION_INTERRUPTED") {
          run = { ...run, state: "INTERRUPTED", error: "interrupted", retryable: true };
          input.store.saveRun(run);
          break;
        }
        run.failedOrderIds.push(orderId);
      }
    }
    run.fetchedDetailCount = run.fetchedDetails.length;
    input.store.saveRun(run);
    if (run.state === "INTERRUPTED") {
      const evidence = finishEvidence(run, input, startedAt, now, {
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
        bundle: { orders: [], items: [], sessions: [] },
        rawChecksum: null,
        listingChecksumValue: await listingChecksum(run.listedOrderIds),
        qualified: false,
        validationPass: false,
        publicationOk: false,
        ingestOk: false,
      });
      input.store.persistEvidence(evidence);
      return {
        run,
        evidence,
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
      };
    }

    const { bundle, malformedCount } = canonicalizeDetails(run.fetchedDetails, now.toISOString());
    const gate = gateAuthenticatedListing({
      listingCount: run.listingCount,
      fetchedDetailCount: run.fetchedDetails.length,
      failedCount: run.failedOrderIds.length,
      malformedCount,
      duplicateIds: listing.orderIds.filter(Boolean).length - uniqueIds.length,
    });
    if (!gate.ok) {
      run = { ...run, state: run.failedOrderIds.length ? "ACQUIRE_FAILED" : "VALIDATE_FAILED", error: gate.errors.join(","), retryable: true };
      input.store.saveRun(run);
      const evidence = finishEvidence(run, input, startedAt, now, {
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
        bundle,
        rawChecksum: run.fetchedDetails.length ? await checksumRawDetails(run.fetchedDetails) : null,
        listingChecksumValue: await listingChecksum(run.listedOrderIds),
        qualified: false,
        validationPass: false,
        publicationOk: false,
        ingestOk: false,
      });
      input.store.persistEvidence(evidence);
      return {
        run,
        evidence,
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
      };
    }

    run = { ...run, state: "VALIDATED", error: null, retryable: true };
    if (malformedCount > 0) {
      run = { ...run, state: "CANONICALIZE_FAILED", error: "malformed_source_response", retryable: true };
      input.store.saveRun(run);
      const evidence = finishEvidence(run, input, startedAt, now, {
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
        bundle,
        rawChecksum: await checksumRawDetails(run.fetchedDetails),
        listingChecksumValue: await listingChecksum(run.listedOrderIds),
        qualified: false,
        validationPass: false,
        publicationOk: false,
        ingestOk: false,
      });
      input.store.persistEvidence(evidence);
      return {
        run,
        evidence,
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
      };
    }

    const dateMismatch = bundle.orders.filter((o) => o.businessDate !== input.businessDate);
    if (dateMismatch.length) {
      run = { ...run, state: "VALIDATE_FAILED", error: "business_date_mismatch", retryable: true };
      input.store.saveRun(run);
      const evidence = finishEvidence(run, input, startedAt, now, {
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
        bundle,
        rawChecksum: await checksumRawDetails(run.fetchedDetails),
        listingChecksumValue: await listingChecksum(run.listedOrderIds),
        qualified: false,
        validationPass: false,
        publicationOk: false,
        ingestOk: false,
      });
      input.store.persistEvidence(evidence);
      return {
        run,
        evidence,
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
      };
    }

    run = { ...run, state: "CANONICALIZED", error: null, retryable: true };
    const quality = gate.zeroOrderDay
      ? { ok: true, sessionMixReady: true, errors: [] as string[] }
      : evaluatePublicationQuality({
        joinRate: joinRate(bundle.orders, bundle.items),
        duplicateRate: duplicateRate(bundle.orders.map((o) => o.sourceOrderId)),
        schemaValid: true,
        unclassifiedSessionRate: bundle.sessions.length
          ? bundle.sessions.filter((s) => s.archetype === "unclassified").length / bundle.sessions.length
          : 0,
      });
    if (!quality.ok) {
      run = { ...run, state: "PUBLISH_FAILED", error: quality.errors.join(","), retryable: true };
      input.store.saveRun(run);
      const evidence = finishEvidence(run, input, startedAt, now, {
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
        bundle,
        rawChecksum: await checksumRawDetails(run.fetchedDetails),
        listingChecksumValue: await listingChecksum(run.listedOrderIds),
        qualified: false,
        validationPass: true,
        publicationOk: false,
        ingestOk: true,
      });
      input.store.persistEvidence(evidence);
      return {
        run,
        evidence,
        idempotencyResult: "not_applicable",
        previousWatermark: input.store.getWatermark(input.branchId),
        newWatermark: input.store.getWatermark(input.branchId),
      };
    }

    const rawChecksum = gate.zeroOrderDay
      ? await checksumRawDetails([])
      : await checksumRawDetails(run.fetchedDetails);
    const listingChecksumValue = await listingChecksum(run.listedOrderIds);
    const previousWatermark = input.store.getWatermark(input.branchId);
    const publishedRecord: PublishedDayRecord = {
      businessDate: input.businessDate,
      listingCount: run.listingCount,
      listingChecksum: listingChecksumValue,
      rawChecksum,
      orderCount: bundle.orders.length,
      itemCount: bundle.items.length,
      sessionCount: bundle.sessions.length,
      runId,
    };
    const { newWatermark } = input.store.publish({
      branchId: input.branchId,
      businessDate: input.businessDate,
      bundle,
      record: publishedRecord,
    });
    run = { ...run, state: "PUBLISHED", error: null, retryable: false };
    input.store.saveRun(run);
    const evidence = finishEvidence(run, input, startedAt, now, {
      idempotencyResult: "published_new",
      previousWatermark,
      newWatermark,
      bundle,
      rawChecksum,
      listingChecksumValue,
      qualified: undefined,
      validationPass: true,
      publicationOk: true,
      ingestOk: true,
    });
    const proofState = applyQualifiedProofResult(input.store.getProofState(), {
      eligible: evidence.qualified,
      classification: evidence.proofClassification || "PUBLICATION_FAILED",
      businessDate: input.businessDate,
    });
    input.store.setProofState(proofState);
    input.store.persistEvidence(evidence);
    return {
      run,
      evidence,
      idempotencyResult: "published_new",
      previousWatermark,
      newWatermark,
    };
  } catch (err) {
    run = { ...run, state: "ACQUIRE_FAILED", error: err instanceof Error ? err.message : String(err), retryable: true };
    input.store.saveRun(run);
    const evidence = finishEvidence(run, input, startedAt, now, {
      idempotencyResult: "not_applicable",
      previousWatermark: input.store.getWatermark(input.branchId),
      newWatermark: input.store.getWatermark(input.branchId),
      bundle: { orders: [], items: [], sessions: [] },
      rawChecksum: null,
      listingChecksumValue: null,
      qualified: false,
      validationPass: false,
      publicationOk: false,
      ingestOk: false,
    });
    input.store.persistEvidence(evidence);
    return {
      run,
      evidence,
      idempotencyResult: "not_applicable",
      previousWatermark: input.store.getWatermark(input.branchId),
      newWatermark: input.store.getWatermark(input.branchId),
    };
  }
}

function finishEvidence(
  run: AcquisitionRun,
  input: { branchId: string; businessDate: string; invocationSource: AcquisitionInvocationSource; store: AcquisitionStore },
  startedAt: Date,
  completedAt: Date,
  extra: {
    idempotencyResult: IdempotencyResult;
    previousWatermark: string | null;
    newWatermark: string | null;
    bundle: CanonicalDayBundle;
    rawChecksum: string | null;
    listingChecksumValue: string | null;
    qualified?: boolean;
    validationPass: boolean;
    publicationOk: boolean;
    ingestOk: boolean;
  },
): AcquisitionEvidenceRecord {
  return buildAcquisitionEvidence({
    runId: run.runId,
    invocationSource: input.invocationSource,
    riyadhStartedAt: riyadhOffsetTimestamp(startedAt),
    riyadhCompletedAt: riyadhOffsetTimestamp(completedAt),
    targetBusinessDate: input.businessDate,
    branchId: input.branchId,
    acquisitionMethod: "authenticated_read",
    listingCount: run.listingCount,
    fetchedDetailCount: run.fetchedDetailCount,
    itemCount: extra.bundle.items.length,
    rawChecksums: {
      listing: extra.listingChecksumValue,
      rawBatch: extra.rawChecksum,
    },
    canonicalOrderCount: extra.bundle.orders.length,
    canonicalItemCount: extra.bundle.items.length,
    canonicalSessionCount: extra.bundle.sessions.length,
    previousWatermark: extra.previousWatermark,
    newWatermark: extra.newWatermark,
    publicationDestination: "commerce_orders+commerce_order_items+commerce_sessions",
    publicationVersion: COMMERCE_DERIVATION_VERSION,
    idempotencyResult: extra.idempotencyResult,
    finalState: run.state,
    qualified: extra.qualified,
    liveListCount: run.listingCount,
    liveDetailCalls: run.fetchedDetailCount,
    representativeOrderId: run.listedOrderIds[0] || null,
    rawBytes: extra.rawChecksum ? 1 : 0,
    ingestOk: extra.ingestOk,
    validationPass: extra.validationPass,
    publicationOk: extra.publicationOk,
    sourceCompleted: true,
  });
}

export type BridgeRunResult = {
  plan: CatchupPlan;
  results: DateAcquisitionResult[];
  publishedDates: string[];
  watermark: string | null;
  failedDates: string[];
  mondayOffRecoversOnNextRun: boolean;
  officialExportStatus: "BLOCKED_EXTERNAL_DEPENDENCY";
};

export async function runAuthenticatedFoodicsBridge(input: {
  branchId: string;
  asOf: Date | string;
  source: FoodicsAuthenticatedSource;
  store: AcquisitionStore;
  epochStart?: string | null;
  requestedSource?: AcquisitionInvocationSource | null;
}): Promise<BridgeRunResult> {
  const plan = planCompletedDayAcquisition({
    asOf: input.asOf,
    publishedDates: input.store.getPublishedDates(input.branchId),
    watermark: input.store.getWatermark(input.branchId),
    epochStart: input.epochStart,
    openGaps: input.store.getOpenGaps(input.branchId),
    requestedSource: input.requestedSource,
  });
  const results: DateAcquisitionResult[] = [];
  for (const businessDate of plan.datesOldestFirst) {
    results.push(await acquireCompletedBusinessDate({
      branchId: input.branchId,
      businessDate,
      asOf: input.asOf,
      source: input.source,
      store: input.store,
      invocationSource: plan.invocationSource,
    }));
  }
  const failedDates = results.filter((row) => row.run.state !== "PUBLISHED" && row.run.state !== "IDEMPOTENT_NOOP").map((row) => row.run.businessDate);
  return {
    plan,
    results,
    publishedDates: input.store.getPublishedDates(input.branchId),
    watermark: input.store.getWatermark(input.branchId),
    failedDates,
    mondayOffRecoversOnNextRun: true,
    officialExportStatus: "BLOCKED_EXTERNAL_DEPENDENCY",
  };
}
