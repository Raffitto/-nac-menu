/**
 * External context retrieval for NIL business reasoning.
 * Read-only: fetches DB rows when present; returns empty when tables are missing or no rows.
 */

import { scoreSignalPeriodOverlap } from "../../externalContext/externalContextContract";
import { EXTERNAL_CONTEXT_UNAVAILABLE_NOTE } from "../../externalContext/externalContextContract";
import {
  adaptExternalContextToNilBundle,
  hasExternalContextSignals,
} from "../../externalContext/adapters/externalContextSignalAdapter";
import {
  canReadCompetitor,
  canReadCompetitorObservation,
  canReadExternalContextSignal,
} from "../../externalContext/externalContextRlsContract";

const SIGNAL_SELECT =
  "id,branch_id,applies_to_all_branches,signal_type,signal_subtype,title,description,signal_date,start_at,end_at,location_label,source_type,source_name,source_url,source_reliability,confidence,impact_direction,impacted_metrics,related_competitor_id,metadata";

const COMPETITOR_SELECT = "id,name,normalized_name,branch_id,area_label,is_active";

const OBSERVATION_SOURCE_TYPE_LABELS = Object.freeze({
  manual: "Competitor Observation",
  manager_report: "Manager Observation",
  staff_report: "Staff Report",
  import: "Import",
});

function isMissingTableError(error) {
  const msg = `${error?.code || ""} ${error?.message || ""}`;
  return /does not exist|relation.*not found|42P01|PGRST205|Could not find the table/i.test(msg);
}

function dedupeById(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const id = row?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Union of current + previous NIL compare windows.
 * @param {object} [input]
 * @returns {{ startDate: string|null, endDate: string|null }}
 */
export function resolveNilCombinedPeriodBounds(input = {}) {
  const dates = [];
  const { vaultCompare, startDate, endDate, vaultPeriod } = input;
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

/**
 * @param {Record<string, unknown>} row
 * @param {{ startDate?: string, endDate?: string }} period
 */
export function rowOverlapsNilPeriod(row = {}, period = {}) {
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
      { start_at: start, end_at: end, signal_date: row.signal_date },
      period,
    );
    return overlap === "high" || overlap === "medium";
  }

  return false;
}

/**
 * @param {Array<Record<string, unknown>>} signals
 * @param {import("../../externalContext/externalContextRlsContract").VaultAccessScope|null} [scope]
 * @param {{ startDate?: string, endDate?: string }} [period]
 */
export function filterExternalContextSignalsForAccess(signals = [], scope = null, period = {}) {
  return signals.filter((row) => {
    if (scope && !canReadExternalContextSignal(scope, row)) return false;
    return rowOverlapsNilPeriod(row, period);
  });
}

/**
 * @param {Array<Record<string, unknown>>} observations
 * @param {import("../../externalContext/externalContextRlsContract").VaultAccessScope|null} [scope]
 * @param {{ startDate?: string, endDate?: string }} [period]
 */
export function filterCompetitorObservationsForAccess(observations = [], scope = null, period = {}) {
  return observations.filter((row) => {
    if (scope && !canReadCompetitorObservation(scope, row)) return false;
    return rowOverlapsNilPeriod(row, period);
  });
}

/**
 * @param {Record<string, unknown>} row
 */
export function formatExternalSignalSourceLabel(row = {}) {
  if (row.source_name && String(row.source_name).trim()) {
    return String(row.source_name).trim();
  }
  return null;
}

/**
 * @param {Record<string, unknown>} row
 */
export function formatCompetitorObservationSourceLabel(row = {}) {
  const mapped = OBSERVATION_SOURCE_TYPE_LABELS[row.source_type];
  if (mapped) return mapped;
  if (row.source_type) return String(row.source_type);
  return "Competitor Observation";
}

/**
 * @param {{ externalSignals?: unknown[], competitorObservations?: unknown[] }} input
 * @returns {string[]}
 */
export function collectExternalContextSourceLabels(input = {}) {
  const labels = new Set();
  for (const row of input.externalSignals || []) {
    const label = formatExternalSignalSourceLabel(row);
    if (label) labels.add(label);
  }
  for (const row of input.competitorObservations || []) {
    labels.add(formatCompetitorObservationSourceLabel(row));
  }
  return [...labels].sort();
}

/**
 * @param {object} input
 * @returns {{ nilBundle: object, connected: boolean, sourceLabels: string[], externalSignals: unknown[], competitorObservations: unknown[], competitors: unknown[] }}
 */
export function buildExternalContextNilPayload(input = {}) {
  const externalSignals = input.externalSignals || [];
  const competitorObservations = input.competitorObservations || [];
  const competitors = input.competitors || [];

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

/**
 * @param {string} text
 * @param {{ connected?: boolean, sourceLabels?: string[] }} [options]
 */
export function appendExternalContextSection(text, options = {}) {
  const { connected = false, sourceLabels = [] } = options;
  if (!connected || !sourceLabels.length) {
    return `${text}\n\nExternal Context\n\n* ${EXTERNAL_CONTEXT_UNAVAILABLE_NOTE}`;
  }
  const bullets = sourceLabels.map((label) => `* ${label}`).join("\n");
  return `${text}\n\nExternal Context Sources\n\n${bullets}`;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} context
 * @returns {Promise<{ externalSignals: unknown[], competitorObservations: unknown[], competitors: unknown[] }>}
 */
export async function fetchExternalContextForNilPeriod(supabase, context = {}) {
  const period = resolveNilCombinedPeriodBounds(context);
  const empty = { externalSignals: [], competitorObservations: [], competitors: [] };
  if (!period.startDate || !period.endDate || !supabase) return empty;

  const branch = context.branch ?? context.branchId ?? null;
  const scope = context.vaultAccessScope || null;

  try {
    let externalSignals = [];

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

    let competitorObservations = [];
    let competitors = [];

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
          competitors = compRows.filter((row) => !scope || canReadCompetitor(scope, row));
        }
      }
    }

    return { externalSignals, competitorObservations, competitors };
  } catch {
    return empty;
  }
}
