/**
 * Durable local acquisition store. Proof/watermark live on a stable path.
 * Atomic JSON writes (temp + rename). Does not invent live Foodics data.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BRANCH, STATE_SCHEMA } from "./constants.mjs";
import { buildProofArtifact, proofFilePaths } from "./launchdWiring.mjs";

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function addCalendarDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n) => String(n).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

function contiguousCompleteThrough(publishedDates) {
  const sorted = [...new Set(publishedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!sorted.length) return null;
  let through = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== addCalendarDays(through, 1)) break;
    through = sorted[i];
  }
  return through;
}

const EMPTY_PROOF = {
  visualEnabled: true,
  consecutiveSuccesses: 0,
  genuineFullChainSuccesses: 0,
  force: null,
  lastSourceMode: "authenticated_read_fallback",
  lastSchemaFingerprint: null,
  qualifiedBusinessDates: [],
};

export function createFilesystemAcquisitionStore(stateRoot, extra = {}) {
  const root = path.resolve(stateRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const publishedPath = path.join(root, "published.json");
  const watermarkPath = path.join(root, "watermark.json");
  const runsPath = path.join(root, "runs.json");
  const evidencePath = path.join(root, "evidence.json");
  const canonicalPath = path.join(root, "canonical.json");
  const proofStatePath = path.join(root, "proof-state.json");
  const launchdTrigger = extra.launchdTrigger || null;
  const invokedBy = extra.invokedBy || null;

  const loadMaps = () => ({
    published: readJson(publishedPath, {}),
    watermark: readJson(watermarkPath, { schema: STATE_SCHEMA, watermark: {} }),
    runs: readJson(runsPath, {}),
    evidence: readJson(evidencePath, {}),
    canonical: readJson(canonicalPath, {}),
    proofState: readJson(proofStatePath, EMPTY_PROOF),
  });

  const key = (branchId, date) => `${branchId}:${date}`;

  return {
    getPublishedDates(branchId) {
      const { published } = loadMaps();
      return Object.keys(published)
        .filter((k) => k.startsWith(`${branchId}:`))
        .map((k) => k.slice(branchId.length + 1))
        .sort();
    },
    getWatermark(branchId) {
      const { watermark, published } = loadMaps();
      return watermark.watermark?.[branchId]
        || contiguousCompleteThrough(
          Object.keys(published).filter((k) => k.startsWith(`${branchId}:`)).map((k) => k.slice(branchId.length + 1)),
        );
    },
    getOpenGaps(branchId) {
      const { runs } = loadMaps();
      return Object.values(runs)
        .filter((run) => run.branchId === branchId && run.state !== "PUBLISHED" && run.state !== "IDEMPOTENT_NOOP")
        .map((run) => run.businessDate)
        .sort();
    },
    getPublishedDay(branchId, businessDate) {
      return loadMaps().published[key(branchId, businessDate)] || null;
    },
    getRun(branchId, businessDate) {
      return loadMaps().runs[key(branchId, businessDate)] || null;
    },
    saveRun(run) {
      const maps = loadMaps();
      maps.runs[key(run.branchId, run.businessDate)] = { ...run, fetchedDetails: [...(run.fetchedDetails || [])] };
      atomicWrite(runsPath, maps.runs);
    },
    publish({ branchId, businessDate, bundle, record }) {
      const maps = loadMaps();
      const previousWatermark = maps.watermark.watermark?.[branchId] || null;
      maps.published[key(branchId, businessDate)] = record;
      maps.canonical[key(branchId, businessDate)] = {
        orders: [...bundle.orders],
        items: [...bundle.items],
        sessions: [...bundle.sessions],
      };
      const dates = Object.keys(maps.published)
        .filter((k) => k.startsWith(`${branchId}:`))
        .map((k) => k.slice(branchId.length + 1));
      const next = contiguousCompleteThrough(dates);
      maps.watermark = {
        schema: STATE_SCHEMA,
        watermark: { ...(maps.watermark.watermark || {}), [branchId]: next },
      };
      atomicWrite(publishedPath, maps.published);
      atomicWrite(canonicalPath, maps.canonical);
      atomicWrite(watermarkPath, maps.watermark);
      return { previousWatermark, newWatermark: next };
    },
    persistEvidence(row) {
      const maps = loadMaps();
      maps.evidence[row.runId] = row;
      atomicWrite(evidencePath, maps.evidence);
      const artifact = buildProofArtifact({
        ...row,
        launchdTrigger,
        invokedBy,
      });
      const files = proofFilePaths(root, row);
      atomicWrite(files.runPath, artifact);
      atomicWrite(files.datePath, artifact);
      atomicWrite(files.invocationIndexPath, artifact);
      atomicWrite(files.lastPath, artifact);
    },
    getEvidence(runId) {
      return loadMaps().evidence[runId] || null;
    },
    listEvidence(branchId) {
      return Object.values(loadMaps().evidence).filter((row) => !branchId || row.branchId === branchId);
    },
    getProofState() {
      return loadMaps().proofState;
    },
    setProofState(state) {
      atomicWrite(proofStatePath, state);
    },
    getCanonical(branchId, businessDate) {
      return loadMaps().canonical[key(branchId, businessDate)] || null;
    },
  };
}

export function loadWatermark(stateRoot, branchId = DEFAULT_BRANCH) {
  const doc = readJson(path.join(stateRoot, "watermark.json"), null);
  if (!doc) return null;
  return doc.watermark?.[branchId] || doc.watermark || null;
}
