/**
 * External context retrieval for NIL business reasoning (Edge mirror).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { EXTERNAL_CONTEXT_UNAVAILABLE_NOTE, scoreSignalPeriodOverlap } from "./externalContextContract.ts";
import {
  adaptExternalContextToNilBundle,
  hasExternalContextSignals,
} from "./externalContextSignalAdapter.ts";
import {
  canReadCompetitor,
  canReadCompetitorObservation,
  canReadExternalContextSignal,
} from "./externalContextRlsContract.ts";

const SIGNAL_SELECT =
  "id,branch_id,applies_to_all_branches,signal_type,signal_subtype,title,description,signal_date,start_at,end_at,location_label,source_type,source_name,source_url,source_reliability,confidence,impact_direction,impacted_metrics,related_competitor_id,metadata";

const COMPETITOR_SELECT = "id,name,normalized_name,branch_id,area_label,is_active";

const OBSERVATION_SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: "Competitor Observation",
  manager_report: "Manager Observation",
  staff_report: "Staff Report",
  import: "Import",
};

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const msg = `${error?.code || ""} ${error?.message || ""}`;
  return /does not exist|relation.*not found|42P01|PGRST205|Could not find the table/i.test(msg);
}

function dedupeById(rows: Record<string, unknown>[] = []) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = row?.id as string;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function resolveNilCombinedPeriodBounds(input: Record<string, unknown> = {}) {
  const dates: string[] = [];
  const vaultCompare = input.vaultCompare as {
    current?: { startDate?: string; endDate?: string };
    previous?: { startDate?: string; endDate?: string };
  } | undefined;
  const vaultPeriod = input.vaultPeriod as { startDate?: string; endDate?: string } | undefined;
  const startDate = input.startDate as string | undefined;
  const endDate = input.endDate as string | undefined;

  if (vaultCompare?.current?.startDate) {
    dates.push(vaultCompare.current.startDate, vaultCompare.current.endDate || vaultCompare.current.startDate);
  }
  if (vaultCompare?.previous?.startDate) {
    dates.push(vaultCompare.previous.startDate, vaultCompare.previous.endDate || vaultCompare.previous.startDate);
  }
  if (startDate) dates.push(startDate, endDate || startDate);
  if (vaultPeriod?.startDate) {
    dates.push(vaultPeriod.startDate, vaultPeriod.endDate || vaultPeriod.startDate);
  }
  const valid = dates.filter(Boolean).sort();
  if (!valid.length) return { startDate: null, endDate: null };
  return { startDate: valid[0], endDate: valid[valid.length - 1] };
}

export function rowOverlapsNilPeriod(
  row: Record<string, unknown> = {},
  period: { startDate?: string; endDate?: string } = {},
) {
  const { startDate, endDate } = period;
  if (!startDate || !endDate) return true;

  if (row.signal_date) {
    const d = String(row.signal_date);
    return d >= startDate && d <= endDate;
  }

  if (row.observation_date) {
    const d = String(row.observation_date);
    return d >= startDate && d <= endDate;
  }

  const start = row.start_at || row.signal_date;
  const end = row.end_at || row.start_at || row.signal_date;
  if (start) {
    const overlap = scoreSignalPeriodOverlap(
      { start_at: start as string, end_at: end as string, signal_date: row.signal_date as string },
      period,
    );
    return overlap === "high" || overlap === "medium";
  }

  return false;
}

export function filterExternalContextSignalsForAccess(
  signals: Record<string, unknown>[] = [],
  scope: Record<string, unknown> | null = null,
  period: { startDate?: string; endDate?: string } = {},
) {
  return signals.filter((row) => {
    if (scope && !canReadExternalContextSignal(scope as never, row)) return false;
    return rowOverlapsNilPeriod(row, period);
  });
}

export function filterCompetitorObservationsForAccess(
  observations: Record<string, unknown>[] = [],
  scope: Record<string, unknown> | null = null,
  period: { startDate?: string; endDate?: string } = {},
) {
  return observations.filter((row) => {
    if (scope && !canReadCompetitorObservation(scope as never, row)) return false;
    return rowOverlapsNilPeriod(row, period);
  });
}

export function formatExternalSignalSourceLabel(row: Record<string, unknown> = {}) {
  if (row.source_name && String(row.source_name).trim()) {
    return String(row.source_name).trim();
  }
  return null;
}

export function formatCompetitorObservationSourceLabel(row: Record<string, unknown> = {}) {
  const mapped = OBSERVATION_SOURCE_TYPE_LABELS[String(row.source_type || "")];
  if (mapped) return mapped;
  if (row.source_type) return String(row.source_type);
  return "Competitor Observation";
}

export function collectExternalContextSourceLabels(input: Record<string, unknown> = {}) {
  const labels = new Set<string>();
  for (const row of (input.externalSignals as Record<string, unknown>[]) || []) {
    const label = formatExternalSignalSourceLabel(row);
    if (label) labels.add(label);
  }
  for (const row of (input.competitorObservations as Record<string, unknown>[]) || []) {
    labels.add(formatCompetitorObservationSourceLabel(row));
  }
  return [...labels].sort();
}

export function buildExternalContextNilPayload(input: Record<string, unknown> = {}) {
  const externalSignals = (input.externalSignals as Record<string, unknown>[]) || [];
  const competitorObservations = (input.competitorObservations as Record<string, unknown>[]) || [];
  const competitors = (input.competitors as Record<string, unknown>[]) || [];

  const nilBundle = adaptExternalContextToNilBundle({
    externalSignals,
    competitorObservations,
    competitors,
    branchLabel: input.branchLabel,
    periodLabel: input.periodLabel,
    period: input.period,
  });

  const connected = hasExternalContextSignals(nilBundle);
  const sourceLabels = connected
    ? collectExternalContextSourceLabels({ externalSignals, competitorObservations })
    : [];

  return {
    nilBundle,
    connected,
    sourceLabels,
    externalSignals,
    competitorObservations,
    competitors,
  };
}

export function appendExternalContextSection(
  text: string,
  options: { connected?: boolean; sourceLabels?: string[] } = {},
) {
  const { connected = false, sourceLabels = [] } = options;
  if (!connected || !sourceLabels.length) {
    return `${text}\n\nExternal Context\n\n* ${EXTERNAL_CONTEXT_UNAVAILABLE_NOTE}`;
  }
  const bullets = sourceLabels.map((label) => `* ${label}`).join("\n");
  return `${text}\n\nExternal Context Sources\n\n${bullets}`;
}

export async function fetchExternalContextForNilPeriod(
  supabase: SupabaseClient,
  context: Record<string, unknown> = {},
) {
  const period = resolveNilCombinedPeriodBounds(context);
  const empty = { externalSignals: [], competitorObservations: [], competitors: [] };
  if (!period.startDate || !period.endDate || !supabase) return empty;

  const branch = (context.branch ?? context.branchId) as string | null;
  const scope = (context.vaultAccessScope as Record<string, unknown> | null) || null;

  try {
    let externalSignals: Record<string, unknown>[] = [];

    const { data: datedSignals, error: datedError } = await supabase
      .from("external_context_signals")
      .select(SIGNAL_SELECT)
      .gte("signal_date", period.startDate)
      .lte("signal_date", period.endDate);

    if (datedError && !isMissingTableError(datedError)) {
      return empty;
    }
    if (datedSignals?.length) {
      externalSignals = filterExternalContextSignalsForAccess(datedSignals, scope, period);
    }

    const { data: windowSignals, error: windowError } = await supabase
      .from("external_context_signals")
      .select(SIGNAL_SELECT)
      .is("signal_date", null)
      .lte("start_at", `${period.endDate}T23:59:59.999Z`)
      .gte("end_at", `${period.startDate}T00:00:00.000Z`);

    if (!windowError && windowSignals?.length) {
      externalSignals = dedupeById([
        ...externalSignals,
        ...filterExternalContextSignalsForAccess(windowSignals, scope, period),
      ]);
    } else if (windowError && !isMissingTableError(windowError) && !externalSignals.length) {
      return empty;
    }

    let competitorObservations: Record<string, unknown>[] = [];
    let competitors: Record<string, unknown>[] = [];

    if (branch) {
      const { data: obsRows, error: obsError } = await supabase
        .from("competitor_observations")
        .select("*")
        .eq("branch_id", branch)
        .gte("observation_date", period.startDate)
        .lte("observation_date", period.endDate);

      if (obsError && !isMissingTableError(obsError)) {
        return { externalSignals, competitorObservations: [], competitors: [] };
      }

      competitorObservations = filterCompetitorObservationsForAccess(obsRows || [], scope, period);
      const competitorIds = [...new Set(competitorObservations.map((o) => o.competitor_id).filter(Boolean))];

      if (competitorIds.length) {
        const { data: compRows, error: compError } = await supabase
          .from("competitors")
          .select(COMPETITOR_SELECT)
          .in("id", competitorIds);

        if (!compError && compRows?.length) {
          competitors = compRows.filter((row) => !scope || canReadCompetitor(scope as never, row));
        }
      }
    }

    return { externalSignals, competitorObservations, competitors };
  } catch {
    return empty;
  }
}
