/**
 * Deterministic answer verifier — numbers/dates/branch/causality/source safety.
 */

import { assessCausalLanguage } from "./causalPolicy.ts";
import type { ClaimRecord, EvidenceRecord } from "./evidenceLedger.ts";
import { canSourceOverride } from "./sourceAuthority.ts";
import type { CoverageReport } from "./coverageModel.ts";
import { deriveRangeCoverage, formatMissingDatesProse, formatShortSalesDate } from "./coverageWording.ts";
import type { BranchId, DateRange } from "./types.ts";

export type VerifierIssue = {
  code: string;
  detail: string;
};

export type VerifierResult = {
  ok: boolean;
  issues: VerifierIssue[];
  repairedAnswer?: string | null;
};

const DEBUG_LEAK = /\b(vault_cash_up_summary|sales_total|managementPlanner|queryFocus|ASK_NAC_|SELECT\s+)/i;

export function verifySynthesizedAnswer(input: {
  answerText: string;
  branchId?: BranchId | null;
  period?: DateRange | null;
  evidence: EvidenceRecord[];
  claims?: ClaimRecord[];
  coverage?: CoverageReport[];
  presentedSources?: string[];
}): VerifierResult {
  const issues: VerifierIssue[] = [];
  const text = String(input.answerText || "");
  let repaired = text;

  if (DEBUG_LEAK.test(text)) {
    issues.push({ code: "debug_leak", detail: "Internal intent/tool/SQL leaked into answer" });
  }

  if (input.branchId) {
    const otherBranches = ["khobar", "riyadh", "jeddah"].filter((b) => b !== input.branchId);
    const mentionsRequested = new RegExp(input.branchId, "i").test(text);
    const mentionsOther = otherBranches.some((b) => new RegExp(`\\b${b}\\b`, "i").test(text));
    // Only flag hard mismatch when answer asserts a different primary branch label clearly.
    if (!mentionsRequested && mentionsOther && /\b(for|in)\s+(khobar|riyadh|jeddah)\b/i.test(text)) {
      issues.push({ code: "wrong_branch_scope", detail: `Answer scope does not match ${input.branchId}` });
    }
  }

  if (input.period?.startDate && input.period?.endDate) {
    const years = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/g) || [];
    for (const iso of years) {
      if (iso < input.period.startDate || iso > input.period.endDate) {
        // Allow comparison dates outside current period.
        if (!/compar|vs|versus|previous|baseline/i.test(text)) {
          issues.push({ code: "date_outside_period", detail: iso });
        }
      }
    }
  }

  const presented = input.presentedSources || [];
  if (presented.includes("foodics") && presented.includes("cash_up")) {
    if (canSourceOverride("foodics", "cash_up")) {
      issues.push({ code: "legacy_override_canonical", detail: "Foodics must not override Cash Up" });
    }
  }
  if (/\bcanonical foodics\b/i.test(text) || /\bfoodics\b.*\bcanonical\b/i.test(text)) {
    issues.push({ code: "legacy_presented_as_canonical", detail: "Foodics presented as canonical" });
  }
  if (/\bfoodics\b/i.test(text) && /\bshift\b/i.test(text) && !/\bnot shift-segregated|not shift segregated\b/i.test(text)) {
    issues.push({
      code: "foodics_shift_segmentation_claim",
      detail: "Foodics must not be presented as shift-segregated authority",
    });
  }

  const forecastClaims = (input.claims || []).filter((c) => c.type === "FORECAST");
  if (forecastClaims.length) {
    const presentsForecastAsFact = /\b(will (be|make|do)|definitely|observed forecast)\b/i.test(text)
      && !/\b(forecast|estimate|expectation|expected)\b/i.test(text);
    if (presentsForecastAsFact) {
      issues.push({
        code: "forecast_presented_as_observed",
        detail: "Forecast language must remain estimate/expectation, not observed fact",
      });
    }
  }
  if (/\bfoodics\b/i.test(text) && /\bshift\b/i.test(text) && !/\bnot\b.*\bshift\b/i.test(text)) {
    issues.push({
      code: "foodics_shift_segmentation_claim",
      detail: "Foodics must not be presented as shift-segregated authority",
    });
  }

  const hasForecastClaim = (input.claims || []).some((c) => c.type === "FORECAST");
  if (hasForecastClaim) {
    const observesForecast = /\b(observed|were|was)\b[^.]*\bforecast\b/i.test(text)
      || /\bforecast\b[^.]*\b(were|was)\s+\d/i.test(text);
    if (observesForecast && !/\bestimate|expectation|not observed\b/i.test(text)) {
      issues.push({
        code: "forecast_presented_as_observed",
        detail: "Forecast figures must not be presented as observed fact",
      });
    }
  }

  if (/\bmargin\b|\bfood cost\b/i.test(text) && !input.evidence.some((e) => e.source === "cost_control" || e.metricOrEvent.includes("margin"))) {
    if (/\bmargin (is|was|at)\s+\d/i.test(text)) {
      issues.push({ code: "unsupported_margin_claim", detail: "Margin figure without cost evidence" });
    }
  }

  // Numeric values mentioned as exact currency/percent should exist in evidence/claims when strict.
  const claimVals = new Set(
    (input.claims || [])
      .map((c) => c.metricValue)
      .filter((v): v is number => v != null && Number.isFinite(v))
      .map((v) => Math.round(v * 100) / 100),
  );
  const evidenceVals = new Set(
    input.evidence
      .map((e) => (typeof e.value === "number" ? e.value : null))
      .filter((v): v is number => v != null)
      .map((v) => Math.round(v * 100) / 100),
  );

  const pcts = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
  for (const pct of pcts) {
    const rounded = Math.round(pct * 100) / 100;
    if (claimVals.size + evidenceVals.size > 0 && !claimVals.has(rounded) && !evidenceVals.has(rounded)) {
      // Soft check: only if we have numeric evidence ledger populated.
      issues.push({ code: "number_not_in_evidence", detail: `${pct}%` });
    }
  }

  const causal = assessCausalLanguage(text, input.claims || [], input.evidence);
  if (!causal.ok) {
    issues.push({ code: "unsupported_causal_wording", detail: causal.violations.join(",") });
    if (causal.sanitizedText) repaired = causal.sanitizedText;
  }

  const granularity = assessPeriodGranularityCompatibility(input);
  if (!granularity.ok) {
    issues.push(...granularity.issues);
  }

  const rangeWording = assessIncompleteRangeWording(input);
  if (!rangeWording.ok) {
    issues.push(...rangeWording.issues);
    if (rangeWording.repairedAnswer) repaired = rangeWording.repairedAnswer;
  }

  return {
    ok: issues.length === 0,
    issues,
    repairedAnswer: issues.length ? repaired : null,
  };
}

/**
 * Partial coverage must not be described as a complete requested window.
 */
export function assessIncompleteRangeWording(input: {
  answerText?: string;
  period?: DateRange | null;
  evidence?: EvidenceRecord[];
  coverage?: CoverageReport[];
}): { ok: boolean; issues: VerifierIssue[]; repairedAnswer?: string } {
  const issues: VerifierIssue[] = [];
  const coverage = deriveRangeCoverage({
    period: input.period,
    coverage: input.coverage,
    evidence: input.evidence,
  });
  if (!coverage.isPartial || !coverage.requestedEnd) {
    return { ok: true, issues };
  }

  const text = String(input.answerText || "");
  const alreadyHonest = /available through|does not have sales|do not have sales|not yet available|incomplete|missing/i.test(text);
  if (alreadyHonest) return { ok: true, issues };

  const requestedEnd = coverage.requestedEnd;
  const endShort = formatShortSalesDate(requestedEnd);
  const endLong = new Date(`${requestedEnd}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const mentionsRequestedEnd = text.includes(requestedEnd)
    || (endShort && text.includes(endShort))
    || (endLong && text.includes(endLong.replace(/ 20\d{2}$/, "")));

  if (!mentionsRequestedEnd && !input.period?.label) return { ok: true, issues };
  if (input.period?.label && text.includes(input.period.label) && !alreadyHonest) {
    issues.push({
      code: "incomplete_range_presented_as_complete",
      detail: `Answer uses requested period ${input.period.label} while coverage is partial`,
    });
  } else if (mentionsRequestedEnd) {
    issues.push({
      code: "incomplete_range_presented_as_complete",
      detail: `Answer includes requested end ${requestedEnd} without stating missing coverage`,
    });
  }

  if (!issues.length) return { ok: true, issues };

  const suffix = [
    coverage.coverageEnd
      ? `Sales are currently available through ${formatShortSalesDate(coverage.coverageEnd)}.`
      : "",
    formatMissingDatesProse(coverage.missingDates),
  ].filter(Boolean).join(" ");

  return {
    ok: false,
    issues,
    repairedAnswer: suffix ? `${text.trim()} ${suffix}` : text,
  };
}

/**
 * A single daily observation must not substantiate an unlabeled monthly total.
 * Evidence day_count / observed coverage must be compatible with the requested period.
 */
export function assessPeriodGranularityCompatibility(input: {
  answerText?: string;
  period?: DateRange | null;
  evidence?: EvidenceRecord[];
  claims?: ClaimRecord[];
}): { ok: boolean; issues: VerifierIssue[] } {
  const issues: VerifierIssue[] = [];
  const period = input.period;
  if (!period?.startDate || !period?.endDate) return { ok: true, issues };

  const start = new Date(`${period.startDate}T12:00:00Z`);
  const end = new Date(`${period.endDate}T12:00:00Z`);
  const requestedDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (requestedDays < 28) return { ok: true, issues };

  const text = String(input.answerText || "");
  const namesMonth = /\b(january|february|march|april|may|june|july|august|september|october|november|december|month|overall)\b/i.test(text)
    || Boolean(period.label && /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(period.label));
  if (!namesMonth) return { ok: true, issues };

  const dayCounts = (input.evidence || [])
    .filter((e) => /day_count|days_included|observed_days|available_days/i.test(String(e.metricOrEvent || "")))
    .map((e) => (typeof e.value === "number" ? e.value : Number(e.value)))
    .filter((n) => Number.isFinite(n));
  const claimDayCounts = (input.claims || [])
    .filter((c) => /day_count|days_included/i.test(String(c.metricKey || c.type || "")))
    .map((c) => c.metricValue)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const observed = [...dayCounts, ...claimDayCounts];
  if (!observed.length) {
    // Detect a single-day evidence period used for an unlabeled monthly total.
    const evidencePeriods = (input.evidence || [])
      .map((e) => e.period)
      .filter((p): p is DateRange => Boolean(p?.startDate && p?.endDate));
    const allSingleDay = evidencePeriods.length > 0
      && evidencePeriods.every((p) => p.startDate === p.endDate);
    if (allSingleDay && !/\bon\s+\d{1,2}\s|on\s+\d{4}-\d{2}-\d{2}|only\s+\d+\s+day/i.test(text)) {
      issues.push({
        code: "period_granularity_mismatch",
        detail: "Daily observation used for unlabeled monthly total claim",
      });
    }
    return { ok: issues.length === 0, issues };
  }

  const minObserved = Math.min(...observed);
  if (minObserved <= 1 && !/\bon\s+\d|only\s+1\s+day|1\s+available day/i.test(text)) {
    issues.push({
      code: "period_granularity_mismatch",
      detail: `Requested ~${requestedDays}-day period but evidence day_count=${minObserved}`,
    });
  }

  return { ok: issues.length === 0, issues };
}
