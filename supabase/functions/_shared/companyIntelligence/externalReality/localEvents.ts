import type { DateRange } from "../types.ts";
import { allowExternalCost } from "./costGovernor.ts";
import { factId, getExternalFact, upsertExternalFact } from "./store.ts";
import type { ExternalContextFact, NormalizedExternalEvent } from "./types.ts";

export type LocalEventDeps = {
  fetchImpl?: typeof fetch;
  seedEvents?: NormalizedExternalEvent[];
};

function shouldSkipLocalFetch() {
  try {
    const g: any = globalThis as any;
    return g.process?.env?.NAC_ALLOW_EXTERNAL_FETCH !== "1"
      && g.Deno?.env?.get?.("NAC_ALLOW_EXTERNAL_FETCH") !== "1";
  } catch {
    return true;
  }
}

/**
 * Bounded local-event lookup. Wikipedia only when class 2 is material.
 * Not a crawler.
 */
export async function fetchLocalEvents(input: {
  period: DateRange;
  branchId: string | null;
  materiallyUseful: boolean;
  deps?: LocalEventDeps;
}): Promise<{ events: NormalizedExternalEvent[]; facts: ExternalContextFact[]; skipped?: string }> {
  const id = factId(["local", input.branchId || "khobar", input.period.startDate, input.period.endDate]);
  const cached = getExternalFact(id);
  if (cached) {
    return { events: (cached.metadata.events as NormalizedExternalEvent[]) || [], facts: [cached] };
  }
  if (input.deps?.seedEvents?.length) {
    const fact = upsertExternalFact(toFact(id, input, input.deps.seedEvents, true)).fact;
    return { events: input.deps.seedEvents, facts: [fact] };
  }
  const gate = allowExternalCost(2, { materiallyUseful: input.materiallyUseful });
  if (!gate.allowed) {
    return { events: [], facts: [], skipped: gate.reason };
  }
  const fetchImpl = input.deps?.fetchImpl || fetch;
  try {
    if (!input.deps?.fetchImpl && shouldSkipLocalFetch()) {
      return { events: [], facts: [], skipped: "live_fetch_skipped_offline_test" };
    }
    const url = "https://en.wikipedia.org/api/rest_v1/page/summary/Khobar";
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { events: [], facts: [], skipped: `wikipedia_http_${res.status}` };
    const body = await res.json() as { extract?: string; content_urls?: { desktop?: { page?: string } } };
    const events: NormalizedExternalEvent[] = [];
    const fact = upsertExternalFact(toFact(id, input, events, false, {
      extract: String(body.extract || "").slice(0, 400),
      page: body.content_urls?.desktop?.page || url,
      note: "Wikipedia city summary is not a structured event calendar; no dated major local events extracted.",
    })).fact;
    return { events, facts: [fact] };
  } catch {
    return { events: [], facts: [], skipped: "wikipedia_unavailable" };
  }
}

function toFact(
  id: string,
  input: { period: DateRange; branchId: string | null },
  events: NormalizedExternalEvent[],
  cached: boolean,
  extra: Record<string, unknown> = {},
): ExternalContextFact {
  return {
    id,
    branchId: input.branchId,
    locationLabel: "Khobar / Dhahran / Dammam",
    type: "local_events",
    startAt: input.period.startDate,
    endAt: input.period.endDate,
    metricOrEvent: "local_event_scan",
    value: events.length,
    units: "events",
    source: "wikipedia_rest_optional",
    sourceUrl: "https://en.wikipedia.org/api/rest_v1/",
    fetchedAt: new Date().toISOString(),
    immutableHistorical: true,
    quality: "low",
    metadata: { events, cached, ...extra },
  };
}
