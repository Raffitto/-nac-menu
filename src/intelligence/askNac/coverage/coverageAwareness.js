/**
 * Ask NAC coverage awareness — never silently substitute available data for requested data.
 */

import { CONFIDENCE_LEVELS } from "../askNacContract";

function parseIsoDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function expectedCalendarDays(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

function formatMonthLabel(iso) {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Assess how well available cash-up facts cover the requested analytical period.
 *
 * @param {object} params
 * @param {{ startDate?: string, endDate?: string, label?: string, periodType?: string }} params.requestedPeriod
 * @param {{ dayCount?: number, dailyBreakdown?: object[], totalSales?: number|null, totalDeliveryOrders?: number|null, deliveryOrderCoverageStart?: string|null, salesCoverageStart?: string|null, salesCoverageEnd?: string|null }} params.aggregation
 * @returns {{
 *   requestedPeriodLabel: string,
 *   availablePeriodLabel: string|null,
 *   completeness: 'complete'|'partial'|'unavailable',
 *   coverageNotes: string[],
 *   confidence: string,
 *   confidenceExplanation: string,
 *   dataConfidence: object,
 * }}
 */
export function assessPeriodCoverage({ requestedPeriod = null, aggregation = null } = {}) {
  const requestedLabel = requestedPeriod?.label
    || (requestedPeriod?.startDate && requestedPeriod?.endDate
      ? `${requestedPeriod.startDate} – ${requestedPeriod.endDate}`
      : "requested period");

  const dayCount = Number(aggregation?.dayCount) || 0;
  const expectedDays = expectedCalendarDays(requestedPeriod?.startDate, requestedPeriod?.endDate);
  const breakdown = Array.isArray(aggregation?.dailyBreakdown) ? aggregation.dailyBreakdown : [];

  const salesDates = breakdown.filter((row) => row.totalSales != null).map((row) => row.date);
  const deliverySalesDates = breakdown.filter((row) => row.totalDeliverySales != null).map((row) => row.date);
  const deliveryOrderDates = breakdown.filter((row) => row.totalDeliveryOrders != null).map((row) => row.date);

  const salesStart = aggregation?.salesCoverageStart || salesDates[0] || null;
  const salesEnd = aggregation?.salesCoverageEnd || salesDates[salesDates.length - 1] || null;
  const deliveryOrderStart = aggregation?.deliveryOrderCoverageStart || deliveryOrderDates[0] || null;

  const coverageNotes = [];
  let completeness = "unavailable";
  let confidence = CONFIDENCE_LEVELS.LOW;
  let confidenceExplanation = "No structured cash-up facts matched the requested period.";

  if (dayCount > 0) {
    const availableLabel = salesStart && salesEnd
      ? (salesStart === salesEnd ? salesStart : `${salesStart} – ${salesEnd}`)
      : `${dayCount} cash-up day(s)`;

    if (expectedDays > 0 && dayCount >= expectedDays) {
      completeness = "complete";
      confidence = CONFIDENCE_LEVELS.HIGH;
      confidenceExplanation = `Sales coverage is complete for ${requestedLabel} (${dayCount} cash-up day(s)).`;
    } else if (expectedDays > 0 && dayCount < expectedDays) {
      completeness = "partial";
      confidence = CONFIDENCE_LEVELS.MEDIUM;
      coverageNotes.push(
        `Requested period: ${requestedLabel}. Available sales coverage: ${availableLabel} (${dayCount} of ~${expectedDays} calendar day(s)).`,
      );
      confidenceExplanation = `Sales coverage is partial — ${dayCount} cash-up day(s) found for a ${expectedDays}-day requested window.`;
    } else {
      completeness = dayCount >= 2 ? "complete" : "partial";
      confidence = dayCount >= 2 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM;
      confidenceExplanation = `${dayCount} cash-up day(s) included for ${requestedLabel}.`;
    }

    if (deliveryOrderStart && requestedPeriod?.startDate && deliveryOrderStart > requestedPeriod.startDate) {
      const reason = `Delivery tracking began ${formatMonthLabel(deliveryOrderStart)} — order totals are partial for the full requested window.`;
      coverageNotes.push(reason);
      if (confidence === CONFIDENCE_LEVELS.HIGH) confidence = CONFIDENCE_LEVELS.MEDIUM;
      confidenceExplanation = `${confidenceExplanation} ${reason}`;
    }

    if (deliverySalesDates.length > 0 && deliveryOrderDates.length === 0) {
      coverageNotes.push("Delivery sales are available, but delivery order counts were not extracted for this range.");
      if (confidence === CONFIDENCE_LEVELS.HIGH) confidence = CONFIDENCE_LEVELS.MEDIUM;
    }

    if (aggregation?.totalDeliveryOrders != null && aggregation?.totalSales != null && aggregation.totalSales > 0) {
      const share = (Number(aggregation.totalDeliverySales || 0) / Number(aggregation.totalSales)) * 100;
      if (Number.isFinite(share)) {
        coverageNotes.push(`Delivery share of net sales: ${share.toFixed(1)}%.`);
      }
    }

    return {
      requestedPeriodLabel: requestedLabel,
      availablePeriodLabel: salesStart && salesEnd ? `${salesStart} – ${salesEnd}` : availableLabel,
      completeness,
      coverageNotes,
      confidence,
      confidenceExplanation,
      dataConfidence: {
        level: confidence,
        explanation: confidenceExplanation,
        requestedPeriod: requestedLabel,
        availableDays: dayCount,
        expectedDays: expectedDays || null,
        salesCoverageStart: salesStart,
        salesCoverageEnd: salesEnd,
        deliveryOrderCoverageStart: deliveryOrderStart,
      },
    };
  }

  return {
    requestedPeriodLabel: requestedLabel,
    availablePeriodLabel: null,
    completeness,
    coverageNotes: [`No cash-up data is available for ${requestedLabel} under current access scope.`],
    confidence,
    confidenceExplanation,
    dataConfidence: {
      level: confidence,
      explanation: confidenceExplanation,
      requestedPeriod: requestedLabel,
      availableDays: 0,
      expectedDays: expectedDays || null,
    },
  };
}

/**
 * Build coverage preamble lines for analytical answers.
 */
export function buildCoverageAnswerLines(coverageAssessment) {
  if (!coverageAssessment) return [];
  const lines = [];
  if (coverageAssessment.requestedPeriodLabel) {
    lines.push(`Requested period: ${coverageAssessment.requestedPeriodLabel}.`);
  }
  if (coverageAssessment.availablePeriodLabel) {
    lines.push(`Available sales coverage: ${coverageAssessment.availablePeriodLabel}.`);
  }
  for (const note of coverageAssessment.coverageNotes || []) {
    if (!lines.includes(note)) lines.push(note);
  }
  if (coverageAssessment.confidenceExplanation) {
    lines.push(`Confidence: ${capitalizeConfidence(coverageAssessment.confidence)} — ${coverageAssessment.confidenceExplanation}`);
  }
  return lines;
}

function capitalizeConfidence(level) {
  const text = String(level || "medium");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
