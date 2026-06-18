/**
 * Deterministic Ask NAC answer builder — structured facts only, no LLM guessing.
 */

import { getMetricDefinition } from "../metrics/metricDefinitions";
import {
  ANSWER_TYPES,
  CONFIDENCE_LEVELS,
  createAskNacResponse,
  metricEntry,
  sourceEntry,
} from "./askNacContract";
import { ASK_NAC_INTENTS, isVaultDataIntent, isVaultDocumentIntent } from "./intentRouter";
import { READINESS } from "./readinessEngine";
import { CONFIDENCE_LABELS } from "../../platform/contracts/dataConfidence";
import { buildVaultAnswer } from "./vault/vaultAnswerBuilder";
import { collectAskNacMetricWarnings } from "./shared/mtdDiagnostics";
import { buildSpecificMissingDataMessage, buildSpecificUnknownMessage } from "./conversation/missingDataMessages";

function confidenceFromTool(tool, routingConfidence) {
  if (tool?.partial) return CONFIDENCE_LEVELS.MEDIUM;
  if (routingConfidence === "high") return CONFIDENCE_LEVELS.HIGH;
  if (routingConfidence === "medium") return CONFIDENCE_LEVELS.MEDIUM;
  return CONFIDENCE_LEVELS.LOW;
}

function buildMissingDataResponse(route, readiness) {
  const def = readiness.missingData?.[0];
  const metricDef = def?.metricId ? getMetricDefinition(def.metricId) : null;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.MISSING_DATA,
    title: metricDef?.label || "Data not available yet",
    directAnswer: buildSpecificMissingDataMessage(route, readiness),
    keyMetrics: [],
    insights: metricDef
      ? [`Canonical source when live: ${metricDef.canonicalSource}`]
      : [],
    recommendations: metricDef?.commonMistakes?.length
      ? [`Avoid: ${metricDef.commonMistakes[0]}`]
      : [],
    sources: metricDef ? [sourceEntry(metricDef.canonicalSource)] : [],
    warnings: [],
    missingData: readiness.missingData || [],
    confidence: CONFIDENCE_LEVELS.NONE,
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: route.period?.rangeId,
    readiness,
  });
}

function buildUnknownResponse(route) {
  return createAskNacResponse({
    answerType: ANSWER_TYPES.UNKNOWN,
    title: "Need a clearer metric question",
    directAnswer: buildSpecificUnknownMessage(),
    insights: [
      "Examples: “How many menu QR scans today?” · “What were sales in May?” · “What were the top 10 items last month?”",
    ],
    confidence: CONFIDENCE_LEVELS.NONE,
    isAiGenerated: false,
    intent: route.intent,
    readiness: { status: READINESS.MISSING },
  });
}

function buildBlockedResponse(route, readiness) {
  return createAskNacResponse({
    answerType: ANSWER_TYPES.ERROR,
    title: "Cannot run this query",
    directAnswer: readiness.reasons?.[0] || "This query is blocked for your role or configuration.",
    warnings: readiness.reasons || [],
    confidence: CONFIDENCE_LEVELS.NONE,
    isAiGenerated: false,
    intent: route.intent,
    readiness,
  });
}

function menuMetricResponse(route, tool, metricKey) {
  const isQr = metricKey === "menuQrScans";
  const def = getMetricDefinition(isQr ? "menu_qr_scan" : "session");
  const value = isQr ? tool.menuQrScans : tool.menuSessions;
  const label = def?.label || (isQr ? "Menu QR Scans" : "Menu Sessions");

  return createAskNacResponse({
    answerType: ANSWER_TYPES.METRIC,
    title: `${label} · ${tool.periodLabel}`,
    directAnswer: `${value.toLocaleString()} ${label.toLowerCase()} for ${tool.branchLabel} (${tool.periodLabel}).`,
    keyMetrics: [
      metricEntry(label, value, { source: def?.canonicalSource }),
      ...(isQr && tool.menuSessions !== value
        ? [metricEntry("Menu Sessions (canonical)", tool.menuSessions, { note: "Distinct menu browsing sessions" })]
        : []),
    ],
    insights: tool.dataSource === "hybrid"
      ? ["Month-to-date uses hybrid rollup + live Today merge."]
      : [],
    recommendations: value === 0
      ? ["No activity in this period — verify branch filter and that guests are scanning the menu QR."]
      : [],
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: collectAskNacMetricWarnings(tool),
    confidence: confidenceFromTool(tool, route.confidence),
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
    diagnostics: tool.mtdHybrid || null,
  });
}

function reviewMetricResponse(route, tool, field) {
  const map = {
    googleRedirects: { id: "google_redirect", label: "Google Redirects" },
    reviewQrScans: { id: "review_qr_scan", label: "Review QR Scans" },
  };
  const meta = map[field];
  const def = getMetricDefinition(meta.id);
  const value = tool[field];

  return createAskNacResponse({
    answerType: ANSWER_TYPES.METRIC,
    title: `${meta.label} · ${tool.periodLabel}`,
    directAnswer: `${value.toLocaleString()} ${meta.label.toLowerCase()} for ${tool.branchLabel} (${tool.periodLabel}).`,
    keyMetrics: [metricEntry(meta.label, value, { source: def?.canonicalSource })],
    insights: [
      field === "googleRedirects"
        ? "Redirects are intent to review on Google — not published Google reviews."
        : "Review QR scans are review portal entry — separate from menu QR scans.",
    ],
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [...(tool.warnings || []), tool.note].filter(Boolean),
    confidence: confidenceFromTool(tool, route.confidence),
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

function staffLeaderboardResponse(route, tool) {
  const top = tool.leaderboard?.[0];
  const directAnswer = top
    ? `${top.name} leads with ${top.googleRedirects} Google redirect${top.googleRedirects === 1 ? "" : "s"} (${tool.periodLabel}, ${tool.branchLabel}).`
    : `No staff-attributed Google redirect data was found for ${tool.periodLabel} at ${tool.branchLabel}.`;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.LEADERBOARD,
    title: `Staff redirect leaderboard · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: (tool.leaderboard || []).slice(0, 5).map((row, i) =>
      metricEntry(`#${i + 1} ${row.name}`, row.googleRedirects, {
        unit: "redirects",
        note: `${row.reviewQrScans} review QR · ${row.branch || "branch n/a"}`,
      }),
    ),
    insights: top
      ? ["Ranking uses Google redirects attributed to staff on review events."]
      : ["Staff attribution requires employee fields on review events for the period."],
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [...(tool.warnings || []), tool.note].filter(Boolean),
    confidence: top ? confidenceFromTool(tool, route.confidence) : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

function formatSar(value) {
  const n = Number(value) || 0;
  return `SAR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function foodicsSources(tool) {
  return (tool.sources || []).map((s) => sourceEntry(s.name, s.detail));
}

function foodicsCoverageInsight(tool) {
  if (tool.batchCoverage) {
    return [`Upload batch: ${tool.batchCoverage}`];
  }
  return [];
}

function foodicsMissingMessageFromTool(tool) {
  const range = tool?.periodLabel || `${tool?.startDate || ""} – ${tool?.endDate || ""}`;
  return `No Foodics waiter/product sales import covers ${range} for ${tool?.branchLabel || "the selected branch"}.`;
}

function buildFoodicsMissingToolResponse(route, tool, readiness) {
  return buildMissingDataResponse(route, {
    ...readiness,
    reasons: readiness?.reasons?.length
      ? readiness.reasons
      : [
          tool?.missingPeriod
            ? "Could not parse a calendar month or date range for this Foodics question."
            : foodicsMissingMessageFromTool(tool),
        ],
    missingData: readiness?.missingData?.length
      ? readiness.missingData
      : [{ intent: route.intent, label: "Foodics sales import", planned: false }],
  });
}

function foodicsSalesTotalResponse(route, tool) {
  const totals = tool.totals || {};
  const directAnswer = `${formatSar(totals.netSales)} net sales for ${tool.branchLabel} (${tool.periodLabel}).`;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.METRIC,
    title: `Foodics sales · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: [
      metricEntry("Net sales", totals.netSales, { unit: "SAR", source: "foodics_sales_items.net_sales" }),
      metricEntry("Gross sales", totals.grossSales, { unit: "SAR", source: "foodics_sales_items.gross_sales" }),
      metricEntry("Units sold", totals.quantity, { source: "foodics_sales_items.quantity_sold" }),
    ],
    insights: [
      ...foodicsCoverageInsight(tool),
      "Totals come from uploaded Foodics waiter/product sales — not menu QR views.",
    ],
    sources: foodicsSources(tool),
    warnings: tool.warnings || [],
    confidence: CONFIDENCE_LEVELS.HIGH,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

function foodicsTopItemsResponse(route, tool) {
  const basis = tool.rankingLabel || "net sales";
  const top = tool.topItems?.[0];
  const directAnswer = top
    ? `#1 by ${basis}: ${top.itemName} (${basis === "quantity sold" ? `${top.quantity} units` : formatSar(top.netSales)}) for ${tool.periodLabel}.`
    : `No ranked items found for ${tool.periodLabel} (${tool.branchLabel}).`;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.LEADERBOARD,
    title: `Top items by ${basis} · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: (tool.topItems || []).map((row) =>
      metricEntry(`#${row.rank} ${row.itemName}`, tool.rankingBasis === "quantity" ? row.quantity : row.netSales, {
        unit: tool.rankingBasis === "quantity" ? "units" : "SAR",
        note: row.category || "",
      }),
    ),
    insights: foodicsCoverageInsight(tool),
    sources: foodicsSources(tool),
    warnings: tool.warnings || [],
    confidence: top ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

function foodicsCompareResponse(route, tool) {
  const basis = tool.rankingBasis === "quantity" ? "quantity" : "net sales";
  const currentLabel = tool.compare?.current?.label || tool.periodLabel;
  const previousLabel = tool.compare?.previous?.label || "previous period";
  const entered = tool.entered || [];
  const dropped = tool.dropped || [];
  const rankChangeDirection = route.rankChangeDirection || "both";

  let directAnswer = "";
  if (route.intent === ASK_NAC_INTENTS.ITEM_RANK_CHANGE) {
    if (rankChangeDirection === "entered") {
      directAnswer = entered.length
        ? `${entered.map((r) => r.itemName).join(", ")} entered the top ${tool.limit} by ${basis} (${currentLabel} vs ${previousLabel}).`
        : `No items newly entered the top ${tool.limit} by ${basis} (${currentLabel} vs ${previousLabel}).`;
    } else if (rankChangeDirection === "dropped") {
      directAnswer = dropped.length
        ? `${dropped.map((r) => r.itemName).join(", ")} dropped from the top ${tool.limit} by ${basis} (${previousLabel} vs ${currentLabel}).`
        : `No items dropped from the top ${tool.limit} by ${basis} (${previousLabel} vs ${currentLabel}).`;
    } else {
      const parts = [];
      if (entered.length) parts.push(`Entered: ${entered.map((r) => r.itemName).join(", ")}`);
      if (dropped.length) parts.push(`Dropped: ${dropped.map((r) => r.itemName).join(", ")}`);
      directAnswer = parts.length
        ? `${parts.join(". ")}.`
        : `No top-${tool.limit} rank changes by ${basis} between ${previousLabel} and ${currentLabel}.`;
    }
  } else {
    directAnswer = `Compared top ${tool.limit} items by ${basis}: ${currentLabel} vs ${previousLabel}.`;
  }

  const keyMetrics = [];
  if (route.intent === ASK_NAC_INTENTS.ITEM_RANK_CHANGE) {
    const rows =
      rankChangeDirection === "dropped"
        ? dropped
        : rankChangeDirection === "entered"
          ? entered
          : [...entered, ...dropped];
    rows.forEach((row) => {
      keyMetrics.push(
        metricEntry(row.itemName, tool.rankingBasis === "quantity" ? row.quantity : row.netSales, {
          unit: tool.rankingBasis === "quantity" ? "units" : "SAR",
          note: entered.includes(row) ? "Entered top list" : "Dropped from top list",
        }),
      );
    });
  } else {
    (tool.currentTop || []).slice(0, tool.limit).forEach((row) => {
      keyMetrics.push(
        metricEntry(`#${row.rank} ${row.itemName}`, tool.rankingBasis === "quantity" ? row.quantity : row.netSales, {
          unit: tool.rankingBasis === "quantity" ? "units" : "SAR",
          note: currentLabel,
        }),
      );
    });
  }

  return createAskNacResponse({
    answerType: ANSWER_TYPES.COMPARISON,
    title:
      route.intent === ASK_NAC_INTENTS.ITEM_RANK_CHANGE
        ? `Top ${tool.limit} rank change · ${basis}`
        : `Top items compare · ${basis}`,
    directAnswer,
    keyMetrics,
    insights: [
      ...foodicsCoverageInsight(tool),
      tool.previousBatchCoverage ? `Previous period batch: ${tool.previousBatchCoverage}` : null,
    ].filter(Boolean),
    sources: foodicsSources(tool),
    warnings: tool.warnings || [],
    confidence: CONFIDENCE_LEVELS.HIGH,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: currentLabel,
    branchLabel: tool.branchLabel,
  });
}

function googleReviewCountResponse(route, tool) {
  const delta = tool.reviewDelta;
  const deltaLabel = delta == null ? null : delta > 0 ? `+${delta}` : String(delta);
  const directAnswer =
    delta != null
      ? `${tool.branchLabel} ${deltaLabel} published Google reviews in ${tool.periodLabel}. Current total: ${tool.currentReviewCount ?? "—"}.`
      : tool.branchReports?.length
        ? `Network published Google review delta for ${tool.periodLabel} is unavailable from snapshot history.`
        : `Google review snapshot history is not available for ${tool.branchLabel} (${tool.periodLabel}).`;

  const keyMetrics = tool.branchReports?.length
    ? tool.branchReports.slice(0, 3).map((row) =>
        metricEntry(row.branch_name, row.period_delta ?? row.month_delta ?? "—", {
          unit: "reviews",
          note: row.current_review_count != null ? `${row.current_review_count} total` : "no history",
        }),
      )
    : [
        metricEntry("Review delta", delta ?? "—", { unit: "reviews", source: "google_review_snapshots" }),
        metricEntry("Current total", tool.currentReviewCount ?? "—", { unit: "reviews" }),
        ...(tool.currentRating != null
          ? [metricEntry("Current rating", tool.currentRating, { unit: "stars" })]
          : []),
      ];

  return createAskNacResponse({
    answerType: ANSWER_TYPES.METRIC,
    title: `Google reviews · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics,
    insights: [tool.historyNote].filter(Boolean),
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: tool.warnings || [],
    confidence: delta != null ? confidenceFromTool(tool, route.confidence) : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

function foodicsCategoryResponse(route, tool) {
  const top = tool.topCategory;
  const directAnswer = top
    ? `${top.category} generated the most revenue (${formatSar(top.netSales)}) in ${tool.periodLabel} for ${tool.branchLabel}.`
    : `No category sales found for ${tool.periodLabel}.`;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.COMPARISON,
    title: `Category sales · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: (tool.categories || []).slice(0, 10).map((row) =>
      metricEntry(row.category, row.netSales, {
        unit: "SAR",
        note: `${row.quantity} units`,
      }),
    ),
    insights: foodicsCoverageInsight(tool),
    sources: foodicsSources(tool),
    warnings: tool.warnings || [],
    confidence: top ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

function foodicsBranchSalesResponse(route, tool) {
  const top = tool.branches?.[0];
  const directAnswer = top
    ? `${top.branchLabel} leads with ${formatSar(top.netSales)} net sales (${tool.periodLabel}).`
    : `No branch Foodics batches overlap ${tool.periodLabel}.`;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.COMPARISON,
    title: `Branch sales · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: (tool.branches || []).map((row) =>
      metricEntry(row.branchLabel, row.netSales, {
        unit: "SAR",
        note: `${row.quantity} units · ${row.batchCoverage || ""}`,
      }),
    ),
    insights: ["Each branch total uses its own overlapping Foodics import batch for the period."],
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [],
    confidence: top ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
  });
}

function branchComparisonResponse(route, tool) {
  const top = tool.rows?.[0];
  const directAnswer = top
    ? `${top.branchLabel} leads with ${top.menuSessions} menu sessions (${tool.periodLabel}).`
    : `No branch comparison rows for ${tool.periodLabel}.`;

  return createAskNacResponse({
    answerType: ANSWER_TYPES.COMPARISON,
    title: `Branch comparison · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: (tool.rows || []).slice(0, 6).map((row) =>
      metricEntry(row.branchLabel, row.menuSessions, {
        unit: "sessions",
        note: `${row.googleRedirects} Google redirects · ${row.reviewQrScans} review QR`,
      }),
    ),
    insights: ["Menu sessions from branch comparison RPC; review metrics merged from review summary."],
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [tool.note].filter(Boolean),
    confidence: top ? confidenceFromTool(tool, route.confidence) : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
  });
}

function executiveAnalysisResponse(route, tool) {
  const summary = tool.summary || {};
  const rankingTable = summary.rankingTable || [];
  const keyFindings = summary.keyFindings || [];
  const recommendedActions = summary.recommendedActions || [];
  const coverage = tool.coverageAssessment || null;

  if (tool.coverageBlocked) {
    return createAskNacResponse({
      answerType: ANSWER_TYPES.EXECUTIVE,
      title: "Insufficient network coverage",
      directAnswer:
        summary.headline || "Insufficient data for a valid network-wide comparison.",
      keyMetrics: (coverage?.branchCoverage || []).map((row) =>
        metricEntry(row.branch_name, row.availableSourceCount, {
          unit: "sources",
          note: row.meaningful ? "Meaningful coverage" : "Limited coverage",
        }),
      ),
      insights: keyFindings.slice(0, 6),
      recommendations: recommendedActions.slice(0, 3),
      sources: [{ name: "dataConfidenceLayer", detail: "coverage assessment before ranking" }],
      warnings: (coverage?.missingSources || []).map((source) => `Missing source: ${source}`),
      confidence: CONFIDENCE_LEVELS.NONE,
      isAiGenerated: false,
      intent: route.intent,
      periodLabel: tool.periodLabel,
      dataConfidence: coverage,
      executiveSummary: {
        winner: null,
        reason: tool.rankingEligibility?.reason || null,
        ranking: [],
        keyFindings,
        recommendedActions,
        confidenceLabel: coverage?.confidenceLevel
          ? CONFIDENCE_LABELS[coverage.confidenceLevel]
          : "Low confidence",
        coverageScores: coverage
          ? {
              dataCoverageScore: coverage.dataCoverageScore,
              branchCoverageScore: coverage.branchCoverageScore,
              timeCoverageScore: coverage.timeCoverageScore,
              sourceCoverageScore: coverage.sourceCoverageScore,
            }
          : null,
      },
    });
  }

  const keyMetrics =
    tool.analysisKind === "stars_gained"
      ? (tool.reviewGrowthRows || []).slice(0, 6).map((row) =>
          metricEntry(row.branch_name, row.growth, {
            unit: "reviews",
            note: `${row.startingReviews} → ${row.currentReviews} (${row.growthPct}%)`,
          }),
        )
      : rankingTable.slice(0, 6).map((row) =>
          metricEntry(`#${row.rank} ${row.branch}`, row.score ?? "—", {
            unit: "score",
            note: `${row.strengths || "—"} · Risk: ${row.risks || "—"}`,
          }),
        );

  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Executive summary · ${tool.periodLabel || route.period?.rangeId || "network"}`,
    directAnswer: summary.headline || "Executive analysis complete.",
    keyMetrics,
    insights: keyFindings.slice(0, 4),
    recommendations: recommendedActions.slice(0, 3),
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [...(tool.warnings || []), tool.note].filter(Boolean),
    confidence: rankingTable.length || tool.reviewGrowthRows?.length
      ? confidenceFromTool(tool, route.confidence)
      : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    executiveSummary: {
      winner: summary.winner || null,
      reason: summary.reason || null,
      ranking: rankingTable,
      keyFindings,
      recommendedActions,
      reviewGrowthRows: tool.reviewGrowthRows || [],
      networkScore: tool.networkScore ?? null,
      confidenceLabel: coverage?.confidenceLevel
        ? CONFIDENCE_LABELS[coverage.confidenceLevel]
        : null,
      coverageScores: coverage
        ? {
            dataCoverageScore: coverage.dataCoverageScore,
            branchCoverageScore: coverage.branchCoverageScore,
            timeCoverageScore: coverage.timeCoverageScore,
            sourceCoverageScore: coverage.sourceCoverageScore,
          }
        : null,
    },
    dataConfidence: coverage,
  });
}

function operationalKnowledgeResponse(route, tool) {
  const summary = tool.summary || {};
  return createAskNacResponse({
    answerType: ANSWER_TYPES.EXECUTIVE,
    title: `Operational knowledge · ${tool.periodLabel || "linked reports"}`,
    directAnswer: summary.headline || "Operational knowledge graph results.",
    keyMetrics: (tool.links || []).slice(0, 6).map((link, index) =>
      metricEntry(`Link ${index + 1}`, link.link_type, {
        note: link.link_reason,
      }),
    ),
    insights: [
      ...(summary.linkedReports || []),
      ...(tool.repeatedIssues || []).map(
        (issue) => `${issue.branch}: ${(issue.terms || []).join(", ")}`,
      ),
    ].slice(0, 5),
    recommendations: tool.links?.length
      ? ["Review linked operational reports together before assigning corrective actions."]
      : ["Upload daily logbooks, reception reports, and sales exports for the same period to build links."],
    sources: (tool.sources || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: tool.warnings || [],
    confidence: tool.links?.length ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  });
}

/**
 * Build deterministic structured response from routing + tool output.
 */
export function buildDeterministicAskNacAnswer(route, tool, readiness) {
  if (readiness?.status === READINESS.BLOCKED) {
    return buildBlockedResponse(route, readiness);
  }

  if (route.intent === ASK_NAC_INTENTS.UNKNOWN) {
    return buildUnknownResponse(route);
  }

  if (readiness?.status === READINESS.MISSING && !readiness.canQuery) {
    return buildMissingDataResponse(route, readiness);
  }

  if (isVaultDataIntent(route.intent) || isVaultDocumentIntent(route.intent)) {
    return buildVaultAnswer(route, tool, readiness);
  }

  if (!tool) {
    return buildBlockedResponse(route, {
      status: READINESS.BLOCKED,
      reasons: ["Query tool returned no data for this route. The document or report may exist, but no matching structured result was produced."],
    });
  }

  if (tool.missingBatch || tool.missingPeriod) {
    return buildFoodicsMissingToolResponse(route, tool, readiness);
  }

  switch (route.intent) {
    case ASK_NAC_INTENTS.MENU_QR_SCANS:
      return menuMetricResponse(route, tool, "menuQrScans");
    case ASK_NAC_INTENTS.MENU_SESSIONS:
      return menuMetricResponse(route, tool, "menuSessions");
    case ASK_NAC_INTENTS.GOOGLE_REDIRECTS:
      return reviewMetricResponse(route, tool, "googleRedirects");
    case ASK_NAC_INTENTS.REVIEW_QR_SCANS:
      return reviewMetricResponse(route, tool, "reviewQrScans");
    case ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD:
      return staffLeaderboardResponse(route, tool);
    case ASK_NAC_INTENTS.BRANCH_COMPARISON:
      return branchComparisonResponse(route, tool);
    case ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS:
      return executiveAnalysisResponse(route, tool);
    case ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE:
      return operationalKnowledgeResponse(route, tool);
    case ASK_NAC_INTENTS.GOOGLE_REVIEWS:
      return googleReviewCountResponse(route, tool);
    case ASK_NAC_INTENTS.SALES_TOTAL:
      return foodicsSalesTotalResponse(route, tool);
    case ASK_NAC_INTENTS.TOP_ITEMS:
      return foodicsTopItemsResponse(route, tool);
    case ASK_NAC_INTENTS.TOP_ITEMS_COMPARE:
    case ASK_NAC_INTENTS.ITEM_RANK_CHANGE:
      return foodicsCompareResponse(route, tool);
    case ASK_NAC_INTENTS.CATEGORY_SALES:
      return foodicsCategoryResponse(route, tool);
    case ASK_NAC_INTENTS.BRANCH_SALES:
      return foodicsBranchSalesResponse(route, tool);
    default:
      return buildMissingDataResponse(route, readiness || { missingData: [], reasons: ["Unsupported intent."] });
  }
}

/**
 * Optional OpenAI explanation wrapper — only narrates verified tool facts.
 * Returns deterministic answer when facts or API key missing.
 */
export async function maybeEnhanceWithOpenAi(deterministicAnswer, toolFacts, options = {}) {
  if (!options.openAiConfigured || !options.explainFn) {
    return deterministicAnswer;
  }

  try {
    const enhanced = await options.explainFn({
      facts: toolFacts,
      deterministicAnswer,
    });
    if (!enhanced?.directAnswer) return deterministicAnswer;
    return {
      ...deterministicAnswer,
      directAnswer: enhanced.directAnswer,
      insights: [...deterministicAnswer.insights, ...(enhanced.insights || [])].filter(Boolean),
      isAiGenerated: true,
    };
  } catch {
    return {
      ...deterministicAnswer,
      warnings: [...deterministicAnswer.warnings, "AI explanation unavailable — showing verified facts only."],
    };
  }
}
