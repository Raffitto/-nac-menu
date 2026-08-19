/**
 * File-backed acquisition store for the Mac bridge runtime.
 * Persists watermark, runs, evidence, and proof artifacts under a stable local path.
 */

import type { AcquisitionEvidenceRecord } from "./acquisitionEvidence.ts";
import {
  createMemoryAcquisitionStore,
  contiguousCompleteThrough,
  type AcquisitionRun,
  type AcquisitionStore,
  type CanonicalDayBundle,
  type PublishedDayRecord,
} from "./acquisitionEngine.ts";
import type { ProofState } from "./proofRetention.ts";
import { buildProofArtifactRecord, proofArtifactPath, type BridgePaths } from "./localBridgeRuntime.ts";

export type LocalStoreState = {
  branchId: string;
  watermark: string | null;
  publishedDates: string[];
  publishedRecords: PublishedDayRecord[];
  proofState: ProofState;
  lastRun: Record<string, unknown> | null;
  lastProofRunId: string | null;
};

export type LocalAcquisitionStore = AcquisitionStore & {
  paths: BridgePaths;
  branchId: string;
  snapshot(): LocalStoreState;
  load(): LocalStoreState;
  writeProofArtifact(
    evidence: AcquisitionEvidenceRecord,
    meta: { trigger: "scheduler" | "manual" | "catch-up" | "login-catch-up"; command?: string[] | null; repoRoot?: string | null },
  ): string;
  recordRunSummary(summary: Record<string, unknown>): void;
};

type FileSystem = {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, content: string): void;
  mkdir(path: string): void;
};

export function createMemoryFileSystem(seed: Record<string, string> = {}): FileSystem & { dump(): Record<string, string> } {
  const files = new Map(Object.entries(seed));
  const dirs = new Set<string>();
  return {
    exists(path) {
      return files.has(path) || dirs.has(path);
    },
    read(path) {
      if (!files.has(path)) throw new Error(`missing_file:${path}`);
      return files.get(path) || "";
    },
    write(path, content) {
      files.set(path, content);
    },
    mkdir(path) {
      dirs.add(path);
    },
    dump() {
      return Object.fromEntries(files.entries());
    },
  };
}

function publishedDatesFromRecords(records: PublishedDayRecord[]): string[] {
  return [...new Set(records.map((row) => row.businessDate))].sort();
}

export function createLocalAcquisitionStore(input: {
  paths: BridgePaths;
  branchId: string;
  fs: FileSystem;
  seed?: {
    published?: PublishedDayRecord[];
    watermark?: string | null;
    proofState?: ProofState;
  };
}): LocalAcquisitionStore {
  const fs = input.fs;
  const memory = createMemoryAcquisitionStore(input.seed || {});
  let lastRun: Record<string, unknown> | null = null;
  let lastProofRunId: string | null = null;

  function hydrateFromState(state: LocalStoreState) {
    for (const record of state.publishedRecords || []) {
      if (!memory.getPublishedDay(input.branchId, record.businessDate)) {
        memory.publish({
          branchId: input.branchId,
          businessDate: record.businessDate,
          bundle: memory.getCanonical(input.branchId, record.businessDate) || { orders: [], items: [], sessions: [] },
          record,
        });
      }
    }
    memory.setProofState(state.proofState);
    lastRun = state.lastRun || null;
    lastProofRunId = state.lastProofRunId || null;
  }

  function persistState() {
    const publishedRecords = memory.getPublishedDates(input.branchId)
      .map((businessDate) => memory.getPublishedDay(input.branchId, businessDate))
      .filter((row): row is PublishedDayRecord => Boolean(row));
    const publishedDates = publishedDatesFromRecords(publishedRecords);
    const state: LocalStoreState = {
      branchId: input.branchId,
      watermark: memory.getWatermark(input.branchId),
      publishedDates,
      publishedRecords,
      proofState: memory.getProofState(),
      lastRun,
      lastProofRunId,
    };
    fs.mkdir(input.paths.dataDir);
    fs.write(input.paths.stateFile, JSON.stringify(state, null, 2));
  }

  function load(): LocalStoreState {
    if (!fs.exists(input.paths.stateFile)) {
      return {
        branchId: input.branchId,
        watermark: memory.getWatermark(input.branchId),
        publishedDates: memory.getPublishedDates(input.branchId),
        publishedRecords: [],
        proofState: memory.getProofState(),
        lastRun,
        lastProofRunId,
      };
    }
    const parsed = JSON.parse(fs.read(input.paths.stateFile)) as LocalStoreState;
    hydrateFromState({
      ...parsed,
      publishedRecords: parsed.publishedRecords || [],
    });
    return {
      branchId: input.branchId,
      watermark: memory.getWatermark(input.branchId),
      publishedDates: memory.getPublishedDates(input.branchId),
      publishedRecords: memory.getPublishedDates(input.branchId)
        .map((businessDate) => memory.getPublishedDay(input.branchId, businessDate))
        .filter((row): row is PublishedDayRecord => Boolean(row)),
      proofState: memory.getProofState(),
      lastRun,
      lastProofRunId,
    };
  }

  if (fs.exists(input.paths.stateFile)) {
    hydrateFromState(JSON.parse(fs.read(input.paths.stateFile)) as LocalStoreState);
  }

  return {
    paths: input.paths,
    branchId: input.branchId,
    snapshot() {
      const publishedRecords = memory.getPublishedDates(input.branchId)
        .map((businessDate) => memory.getPublishedDay(input.branchId, businessDate))
        .filter((row): row is PublishedDayRecord => Boolean(row));
      return {
        branchId: input.branchId,
        watermark: memory.getWatermark(input.branchId),
        publishedDates: publishedDatesFromRecords(publishedRecords),
        publishedRecords,
        proofState: memory.getProofState(),
        lastRun,
        lastProofRunId,
      };
    },
    load,
    getPublishedDates(branchId) {
      return memory.getPublishedDates(branchId);
    },
    getWatermark(branchId) {
      return memory.getWatermark(branchId);
    },
    getOpenGaps(branchId) {
      return memory.getOpenGaps(branchId);
    },
    getPublishedDay(branchId, businessDate) {
      return memory.getPublishedDay(branchId, businessDate);
    },
    getRun(branchId, businessDate) {
      return memory.getRun(branchId, businessDate);
    },
    saveRun(run) {
      memory.saveRun(run);
      fs.mkdir(`${input.paths.dataDir}/runs`);
      fs.write(
        `${input.paths.dataDir}/runs/${run.businessDate}.json`,
        JSON.stringify(run, null, 2),
      );
      persistState();
    },
    publish(args) {
      const result = memory.publish(args);
      persistState();
      return result;
    },
    persistEvidence(evidence) {
      memory.persistEvidence(evidence);
      fs.mkdir(`${input.paths.dataDir}/evidence`);
      fs.write(
        `${input.paths.dataDir}/evidence/${evidence.runId}.json`,
        JSON.stringify(evidence, null, 2),
      );
      lastProofRunId = evidence.runId;
      persistState();
    },
    getEvidence(runId) {
      return memory.getEvidence(runId);
    },
    listEvidence(branchId) {
      return memory.listEvidence(branchId);
    },
    getProofState() {
      return memory.getProofState();
    },
    setProofState(state) {
      memory.setProofState(state);
      persistState();
    },
    getCanonical(branchId, businessDate) {
      return memory.getCanonical(branchId, businessDate);
    },
    writeProofArtifact(evidence, meta) {
      const artifactPath = proofArtifactPath(
        input.paths,
        input.branchId,
        evidence.targetBusinessDate,
        evidence.runId,
      );
      fs.mkdir(artifactPath.slice(0, artifactPath.lastIndexOf("/")));
      const record = buildProofArtifactRecord(evidence, {
        branchId: input.branchId,
        invocationSource: evidence.invocationSource,
        trigger: meta.trigger,
        artifactPath,
        command: meta.command || null,
        repoRoot: meta.repoRoot || null,
      });
      fs.write(artifactPath, JSON.stringify(record, null, 2));
      return artifactPath;
    },
    recordRunSummary(summary) {
      lastRun = summary;
      fs.write(input.paths.lastRunFile, JSON.stringify(summary, null, 2));
      persistState();
    },
  };
}

export function hydrateLocalStoreFromState(
  store: LocalAcquisitionStore,
  state: LocalStoreState,
  publishedRecords: PublishedDayRecord[] = [],
): void {
  for (const record of publishedRecords) {
    store.publish({
      branchId: state.branchId,
      businessDate: record.businessDate,
      bundle: { orders: [], items: [], sessions: [] },
      record,
    });
  }
  if (state.watermark != null) {
    const dates = publishedDatesFromRecords(publishedRecords);
    const computed = contiguousCompleteThrough(dates);
    if (computed !== state.watermark) {
      // trust persisted watermark when local canonical bundles are absent
    }
  }
  store.setProofState(state.proofState);
}

export function canonicalBundleToSupabaseRows(bundle: CanonicalDayBundle): {
  orders: Record<string, unknown>[];
  items: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
} {
  return {
    orders: bundle.orders.map((order) => ({
      source: order.source,
      source_order_id: order.sourceOrderId,
      source_revision: order.sourceRevision,
      branch_id: order.branchId,
      business_date: order.businessDate,
      opened_at: order.openedAt,
      closed_at: order.closedAt,
      order_type: order.orderType,
      table_id: order.tableId,
      covers: order.covers,
      subtotal: order.subtotal,
      discount: order.discount,
      tax: order.tax,
      net_sales: order.netSales,
      status: order.status,
      ingested_at: order.ingestedAt,
    })),
    items: bundle.items.map((item) => ({
      source: item.source,
      source_order_id: item.sourceOrderId,
      source_order_item_id: item.sourceOrderItemId,
      branch_id: item.branchId,
      business_date: item.businessDate,
      product_id: item.productId,
      canonical_menu_item_id: item.canonicalMenuItemId,
      item_name: item.itemName,
      source_category: item.sourceCategory,
      canonical_category: item.canonicalCategory,
      quantity: item.quantity,
      gross_amount: item.grossAmount,
      discount_amount: item.discountAmount,
      net_amount: item.netAmount,
      status: item.status,
      ingested_at: new Date().toISOString(),
    })),
    sessions: bundle.sessions.map((session) => ({
      source_order_id: session.sourceOrderId,
      branch_id: session.branchId,
      business_date: session.businessDate,
      covers: session.covers,
      net_sales: session.netSales,
      item_count: session.itemCount,
      archetype: session.archetype,
      flags: session.flags,
    })),
  };
}
