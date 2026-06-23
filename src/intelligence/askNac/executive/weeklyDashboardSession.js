/**
 * Weekly dashboard session flow — pending inputs then completion.
 */

import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { assessPeriodCoverage, buildCoverageAnswerLines } from "../coverage/coverageAwareness";
import { resolveAnalyticalConfidence } from "../confidence/analyticalConfidence";
import { WEEKLY_DASHBOARD_FIELD_DEFS } from "./manualInputParser";
import {
  createPendingSession,
  updatePendingSession,
  fetchActivePendingSession,
} from "./pendingSessions";
import { fetchManualInputsForPeriod, upsertManualInput } from "./manualInputs";
import { collectWeeklyDashboardData } from "./weeklyDashboardDataCollector";

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Default: week ending last Sunday relative to ref date.
 */
export function resolveWeekEndingPeriod(question = "", refDate = new Date()) {
  const q = String(question || "");
  const explicit = q.match(/week ending\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  if (explicit) {
    const parsed = new Date(`${explicit[1]} 12:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) {
      const endDate = parsed.toISOString().slice(0, 10);
      const startDate = addDays(endDate, -6);
      return {
        startDate,
        endDate,
        periodLabel: `week ending ${endDate}`,
        periodType: "week_ending",
      };
    }
  }

  const ref = new Date(refDate);
  ref.setUTCHours(12, 0, 0, 0);
  const day = ref.getUTCDay();
  const daysSinceSunday = day === 0 ? 7 : day;
  const end = new Date(ref);
  end.setUTCDate(end.getUTCDate() - daysSinceSunday);
  const endDate = end.toISOString().slice(0, 10);
  const startDate = addDays(endDate, -6);

  return {
    startDate,
    endDate,
    periodLabel: `week ending ${endDate}`,
    periodType: "week_ending",
  };
}

function buildInputsMap(manualInputs = [], providedInputs = {}) {
  const map = { ...providedInputs };
  for (const input of manualInputs) {
    map[input.metricKey] = input.metricValue ?? input.metricText;
  }
  return map;
}

function findMissingFields(fieldDefs, inputsMap) {
  return fieldDefs.filter((f) => {
    const val = inputsMap[f.key];
    return val == null || val === "";
  });
}

export async function runWeeklyDashboardSession(
  supabase,
  {
    branch,
    branchLabel,
    userEmail,
    question,
    period,
    pendingSessionId = null,
    manualInput = null,
    profile = null,
  } = {},
) {
  const vaultPeriod = period || resolveWeekEndingPeriod(question);
  const fieldDefs = WEEKLY_DASHBOARD_FIELD_DEFS;

  let session = null;
  if (pendingSessionId) {
    const { fetchPendingSession } = await import("./pendingSessions");
    session = await fetchPendingSession(supabase, pendingSessionId);
  }
  if (!session || session.status !== "pending") {
    session = await fetchActivePendingSession(supabase, {
      branch,
      createdBy: userEmail,
      sessionType: "weekly_dashboard",
    });
  }

  if (!session || session.status !== "pending") {
    session = await createPendingSession(supabase, {
      branch,
      sessionType: "weekly_dashboard",
      missingFields: fieldDefs,
      context: { vaultPeriod, branchLabel },
      createdBy: userEmail,
    });
  }

  const manualForPeriod = await fetchManualInputsForPeriod(supabase, {
    branch,
    periodStart: vaultPeriod.startDate,
    periodEnd: vaultPeriod.endDate,
  });

  let inputsMap = buildInputsMap(manualForPeriod.inputs, session.providedInputs);

  if (manualInput?.metricKey) {
    await upsertManualInput(supabase, {
      branch,
      metricKey: manualInput.metricKey,
      metricLabel: manualInput.metricLabel,
      metricValue: manualInput.metricValue,
      periodStart: vaultPeriod.startDate,
      periodEnd: vaultPeriod.endDate,
      periodLabel: vaultPeriod.periodLabel,
      pendingSessionId: session.id,
      providedBy: userEmail,
    });
    inputsMap = { ...inputsMap, [manualInput.metricKey]: manualInput.metricValue };
    session = await updatePendingSession(supabase, session.id, {
      providedInputs: inputsMap,
    });
  }

  const missing = findMissingFields(fieldDefs, inputsMap);

  if (missing.length > 0) {
    const nextField = missing[0];
    return {
      status: "pending",
      awaitingInput: true,
      pendingSession: session,
      missingFields: missing,
      promptField: nextField,
      vaultPeriod,
      branch,
      branchLabel: branchLabel || branchDisplayName(branch),
      sources: [{ name: "ask_nac_pending_sessions", detail: "weekly dashboard awaiting manual input" }],
    };
  }

  let dashboardPackage = null;
  try {
    dashboardPackage = await collectWeeklyDashboardData(supabase, {
      branch,
      branchLabel: branchLabel || branchDisplayName(branch),
      vaultPeriod,
      manualInputs: inputsMap,
      profile,
    });
  } catch (err) {
    dashboardPackage = null;
  }

  const aggregation = dashboardPackage?.weekAggregation || { dayCount: 0 };
  const coverageAssessment = dashboardPackage?.coverageAssessment
    || assessPeriodCoverage({ requestedPeriod: vaultPeriod, aggregation });
  const confidenceResult = dashboardPackage?.confidenceResult
    || resolveAnalyticalConfidence(coverageAssessment);

  await updatePendingSession(supabase, session.id, {
    status: "complete",
    providedInputs: inputsMap,
    missingFields: [],
    context: { vaultPeriod, branchLabel, completedAt: new Date().toISOString() },
  });

  return {
    status: "complete",
    awaitingInput: false,
    pendingSession: { ...session, status: "complete" },
    vaultPeriod,
    aggregation,
    manualInputs: inputsMap,
    coverageAssessment,
    confidenceResult,
    weeklyDashboardPackage: dashboardPackage,
    branch,
    branchLabel: branchLabel || branchDisplayName(branch),
    sources: [
      ...(dashboardPackage?.sources || []),
      { name: "ask_nac_pending_sessions", detail: "weekly dashboard session complete" },
    ],
  };
}

export function buildWeeklyDashboardAnswerLines(result = {}) {
  const lines = [];
  const { vaultPeriod, aggregation, manualInputs, branchLabel, coverageAssessment } = result;
  const covers = manualInputs?.seven_rooms_covers;

  lines.push(`Weekly dashboard · ${branchLabel} · ${vaultPeriod?.periodLabel || "selected week"}`);
  lines.push("");

  if (aggregation?.totalSales != null) {
    lines.push(`Sales: ${Number(aggregation.totalSales).toLocaleString()} SAR (${aggregation.dayCount || 0} cash-up day(s)).`);
  }
  if (aggregation?.totalGuests != null) {
    lines.push(`Guests (cash-up): ${Number(aggregation.totalGuests).toLocaleString()}.`);
  }
  if (aggregation?.averageSpend != null) {
    lines.push(`Average spend: ${Number(aggregation.averageSpend).toFixed(2)} SAR.`);
  }
  if (covers != null) {
    lines.push(`7Rooms covers: ${covers} (manual input · this period only).`);
  }
  if (aggregation?.totalDeliverySales != null) {
    lines.push(`Delivery sales: ${Number(aggregation.totalDeliverySales).toLocaleString()} SAR.`);
  }

  lines.push("");
  lines.push("Executive summary");
  if (aggregation?.dayCount > 0) {
    lines.push(`Operations uploaded ${aggregation.dayCount} cash-up day(s) for this week.`);
  } else {
    lines.push("Limited vault coverage for this week — treat sales sections as provisional.");
  }
  if (covers != null) {
    lines.push(`Reservation covers (${covers}) were provided manually for this reporting period.`);
  }

  if (coverageAssessment) {
    lines.push("");
    lines.push(...buildCoverageAnswerLines(coverageAssessment));
  }

  return lines;
}
