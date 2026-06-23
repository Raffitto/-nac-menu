/**
 * Store executive evidence manual inputs and update pending sessions.
 */

import { upsertManualInput } from "./manualInputs";
import { updatePendingSession } from "./pendingSessions";
import { storeOperatorMemory } from "./operatorMemory";

export async function storeExecutiveEvidenceManualInput(
  supabase,
  {
    branch,
    branchLabel,
    userEmail,
    manualInput,
    pendingSession,
    vaultPeriod = null,
  } = {},
) {
  const period = vaultPeriod || pendingSession?.context?.vaultPeriod || {};
  const periodStart = period.startDate || period.periodStart;
  const periodEnd = period.endDate || period.periodEnd;
  const periodLabel = period.periodLabel || period.label || "this period";

  const stored = await upsertManualInput(supabase, {
    branch,
    reportType: "executive_evidence",
    metricKey: manualInput.metricKey,
    metricLabel: manualInput.metricLabel,
    metricValue: manualInput.metricValue,
    metricText: manualInput.metricText || (manualInput.metricValue != null ? String(manualInput.metricValue) : null),
    periodStart,
    periodEnd,
    periodLabel,
    pendingSessionId: pendingSession?.id,
    providedBy: userEmail,
  });

  const providedInputs = {
    ...(pendingSession?.providedInputs || {}),
    [manualInput.metricKey]: manualInput.metricValue ?? manualInput.metricText,
  };
  const remainingFields = (pendingSession?.missingFields || []).filter(
    (field) => (field.key || field.metric_key) !== manualInput.metricKey,
  );

  const updatedSession = await updatePendingSession(supabase, pendingSession.id, {
    providedInputs,
    missingFields: remainingFields,
    status: remainingFields.length ? "pending" : "complete",
  });

  let operatorMemory = null;
  if (manualInput.metricText && manualInput.metricValue == null && manualInput.metricText.length > 12) {
    const result = await storeOperatorMemory(supabase, {
      branch,
      fact: `${manualInput.metricLabel}: ${manualInput.metricText}`,
      category: "executive_context",
      taughtBy: userEmail,
    }).catch(() => null);
    operatorMemory = result?.memory || null;
  }

  return {
    branch,
    branchLabel,
    storedInput: stored.input,
    pendingSession: updatedSession,
    missingFields: remainingFields,
    sources: stored.sources,
    operatorMemory: operatorMemory?.memory || null,
    learnNote: operatorMemory?.memory
      ? "Stored as period-specific manual input and permanent operator memory."
      : "Stored as period-specific manual input for this reporting period only.",
  };
}
