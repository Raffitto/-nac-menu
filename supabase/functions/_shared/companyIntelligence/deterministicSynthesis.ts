/**
 * Deterministic templated synthesis for simple answers + offline degradation.
 */

import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";
import type { ComparabilityResult } from "./comparabilityEngine.ts";
import type { CoverageReport } from "./coverageModel.ts";
import type { DateRange } from "./types.ts";
import { allowedInferenceWording } from "./causalPolicy.ts";

function branchLabel(branchId: string | null | undefined) {
  if (!branchId) return "the branch";
  return ({ khobar: "Khobar", riyadh: "Riyadh", jeddah: "Jeddah" } as Record<string, string>)[branchId]
    || branchId;
}

function periodLabel(period: DateRange | null | undefined) {
  if (!period) return "the requested period";
  return period.label || `${period.startDate}–${period.endDate}`;
}

export function synthesizeDeterministicAnswer(input: {
  question: string;
  branchId: string | null;
  period: DateRange | null;
  comparisonPeriod?: DateRange | null;
  forecastPeriod?: DateRange | null;
  nextHolidayDate?: string | null;
  eventWindow?: {
    conventionLabel?: string;
    anchorDate?: string;
    year?: number;
  } | null;
  evidence: EvidenceRecord[];
  claims: ClaimRecord[];
  coverage: CoverageReport[];
  comparability?: ComparabilityResult | null;
  offlineAnalysis?: boolean;
  infeasibleText?: string | null;
}): string {
  if (input.infeasibleText) return input.infeasibleText;

  const sales = input.evidence.find((e) =>
    e.metricOrEvent === "net_sales" && typeof e.value === "number" && e.source !== "event_forecast"
  );
  const covers = input.evidence.find((e) => e.metricOrEvent === "covers" && typeof e.value === "number");
  const delta = input.evidence.find((e) => e.metricOrEvent === "delta_pct" && typeof e.value === "number");
  const forecastSales = input.evidence.find((e) =>
    e.metricOrEvent === "forecast_net_sales" && typeof e.value === "number"
  );
  const forecastConfidence = input.evidence.find((e) => e.metricOrEvent === "forecast_confidence");
  const forecastMethod = input.evidence.find((e) => e.metricOrEvent === "forecast_method");
  const histObs = input.evidence.find((e) => e.metricOrEvent === "historical_event_observations");
  const costMissing = input.claims.some((c) => c.type === "UNSUPPORTED" && /margin|cost/i.test(c.statement));
  const ops = input.evidence.filter((e) => e.source === "logbook").map((e) => e.textSummary).filter(Boolean);

  const branch = branchLabel(input.branchId);
  const period = periodLabel(input.period);
  const parts: string[] = [];

  if (input.eventWindow?.conventionLabel && input.eventWindow?.anchorDate) {
    parts.push(
      `Using the explicit three-day event window (${input.eventWindow.conventionLabel}) around ${input.eventWindow.anchorDate}.`,
    );
  }

  if (costMissing && /\b(margin|losing money|food cost)\b/i.test(input.question)) {
    parts.push(
      `Canonical cost/margin data is unavailable for ${branch}, so I cannot determine where margin is being lost from sales alone.`,
    );
  }

  if (sales) {
    parts.push(
      `For ${branch} in ${period}, observed Cash Up net sales were ${sales.value} SAR.`,
    );
  }
  if (covers) {
    parts.push(`Covers were ${covers.value}.`);
  }

  if (delta && input.comparability?.status !== "not_comparable") {
    const method = input.comparability?.recommendedMethod || "matched_days";
    const direction = Number(delta.value) < 0 ? "down" : Number(delta.value) > 0 ? "up" : "flat";
    if (input.comparability?.status === "partially_comparable" || method === "matched_days" || method === "matched_weekday") {
      parts.push(
        `On a like-for-like (${method}) basis, sales were ${direction} ${Math.abs(Number(delta.value))}%.`,
      );
    } else {
      parts.push(`Compared with the prior period, sales were ${direction} ${Math.abs(Number(delta.value))}%.`);
    }
  } else if (input.comparability?.status === "not_comparable") {
    parts.push("A percentage comparison is not valid for these periods.");
  }

  if (input.comparability?.weekdayComposition?.match === false) {
    parts.push(
      "Weekday composition differs between the compared windows, so they are not treated as like-for-like.",
    );
  }

  if (forecastSales || forecastMethod || /\b(expect|forecast|next founding|next foundation)\b/i.test(input.question)) {
    if (forecastSales) {
      parts.push(
        `FORECAST (estimate, not observed fact): for the next Founding Day window`
          + (input.forecastPeriod ? ` (${periodLabel(input.forecastPeriod)})` : "")
          + `, central estimate is ${forecastSales.value} SAR`
          + (forecastConfidence ? ` with ${forecastConfidence.value} confidence` : "")
          + (forecastMethod ? ` using method ${forecastMethod.value}` : "")
          + ".",
      );
    } else {
      parts.push(
        "FORECAST: insufficient observed same-event history to defend a central sales estimate.",
      );
    }
    if (histObs && Number(histObs.value) <= 1) {
      parts.push(
        `Only ${histObs.value} historical Founding Day observation(s) are available for this branch, so confidence is limited.`,
      );
    }
    parts.push(
      "This forecast does not include weather, local events, economic, or political factors.",
    );
  }

  if (input.nextHolidayDate) {
    parts.push(`The next Saudi Founding Day is ${input.nextHolidayDate}.`);
  }

  for (const cov of input.coverage) {
    if (cov.coverageRatio != null && cov.coverageRatio < 1 && cov.expectedRecords != null && cov.availableRecords != null) {
      if (cov.availableRecords === 0) {
        const requested = input.period?.label
          || (input.period?.startDate && input.period?.endDate && input.period.startDate === input.period.endDate
            ? input.period.startDate
            : period);
        let msg = `Cash Up for ${requested} is not yet available in the canonical data.`;
        const latest = cov.freshness && String(cov.freshness);
        if (
          latest
          && latest !== input.period?.startDate
          && latest !== input.period?.endDate
        ) {
          msg += ` The latest completed Cash Up I have is ${latest}.`;
        }
        parts.push(msg);
      } else {
        parts.push(
          `I can use ${cov.domain} evidence for ${cov.availableRecords} of the requested ${cov.expectedRecords} records; coverage is incomplete.`,
        );
      }
    }
  }

  if (ops.length) {
    parts.push(`In-period logbooks mention: ${ops[0]}`);
    if (/\bwhy|cause|shit|wrong\b/i.test(input.question)) {
      parts.push(allowedInferenceWording());
    }
  }

  if (!parts.length) {
    parts.push(
      `Verified structured evidence for ${branch} in ${period} is limited or unavailable for this question.`,
    );
  }

  if (input.offlineAnalysis) {
    parts.push(
      "Natural-language analysis is unavailable in offline mode; showing verified retrieved data only.",
    );
  }

  return parts.join(" ");
}
