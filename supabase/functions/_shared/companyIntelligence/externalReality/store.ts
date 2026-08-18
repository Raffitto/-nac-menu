/**
 * Idempotent in-process + optional file cache for external_context_facts.
 * Does not write business tables. Optional file dir is local-only.
 */

import type { ExternalContextFact } from "./types.ts";

const memory = new Map<string, ExternalContextFact>();
let fileWrites = 0;
let memoryHits = 0;

export function factId(parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => String(p ?? "").replace(/[^a-zA-Z0-9._-]+/g, "_")).join("|").slice(0, 180);
}

export function resetExternalFactStoreForTests() {
  memory.clear();
  fileWrites = 0;
  memoryHits = 0;
}

export function externalStoreStats() {
  return { size: memory.size, fileWrites, memoryHits };
}

export function upsertExternalFact(fact: ExternalContextFact): { fact: ExternalContextFact; inserted: boolean } {
  const existing = memory.get(fact.id);
  if (existing) {
    memoryHits += 1;
    return { fact: existing, inserted: false };
  }
  memory.set(fact.id, fact);
  persistBestEffort(fact);
  return { fact, inserted: true };
}

export function getExternalFact(id: string): ExternalContextFact | null {
  const hit = memory.get(id) || null;
  if (hit) memoryHits += 1;
  return hit;
}

export function listFactsFor(type: string, startAt: string, endAt: string, branchId?: string | null): ExternalContextFact[] {
  const out: ExternalContextFact[] = [];
  for (const fact of memory.values()) {
    if (fact.type !== type) continue;
    if (branchId && fact.branchId && fact.branchId !== branchId) continue;
    if (fact.endAt < startAt || fact.startAt > endAt) continue;
    out.push(fact);
  }
  return out;
}

function persistBestEffort(fact: ExternalContextFact) {
  try {
    const dir = cacheDir();
    if (!dir) return;
    const payload = JSON.stringify(fact);
    const path = `${dir}/${encodeURIComponent(fact.id)}.json`;
    const g: any = globalThis as any;
    if (g.Deno?.writeTextFileSync) {
      try { g.Deno.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
      g.Deno.writeTextFileSync(path, payload);
      fileWrites += 1;
      return;
    }
    const fs = g.require ? null : null;
    void fs;
  } catch {
    /* local-only best effort */
  }
}

function cacheDir(): string | null {
  try {
    const g: any = globalThis as any;
    const fromDeno = g.Deno?.env?.get?.("NAC_EXTERNAL_CACHE_DIR");
    const fromNode = g.process?.env?.NAC_EXTERNAL_CACHE_DIR;
    return fromDeno || fromNode || "/tmp/nac-external-reality-cache";
  } catch {
    return "/tmp/nac-external-reality-cache";
  }
}
