/**
 * Deterministic Ask NAC answer builder — menu, review, and Foodics intents (not vault).
 */

import { buildMenuMetricAnswerFields } from "./askNacResponseHelpers.ts";
import { branchDisplayName } from "./askNacFoodicsTools.ts";
import { buildVaultAnswer, isVaultDataIntent, isVaultDocumentIntent } from "./askNacVaultTools.ts";

const MAX_STAFF_ROWS = 10;
const MAX_BRANCH_ROWS = 12;

type Route = Record<string, unknown>;
type Tool = Record<string, unknown>;
type Readiness = Record<string, unknown> | null;

function metricEntry(label: string, value: unknown, opts: { unit?: string; source?: string; note?: string } = {}) {
  return { label, value, unit: opts.unit || "", source: opts.source || "", note: opts.note || "" };
}

function sourceEntry(name: string, detail = "") {
  return { name, detail };
}

function confidenceFromTool(tool: Tool, routingConfidence: string) {
  if (tool?.partial) return "medium";
  if (routingConfidence === "high") return "high";
  if (routingConfidence === "medium") return "medium";
  return "low";
}

function formatSar(value: unknown) {
  const n = Number(value) || 0;
  return `SAR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildMissingDataResponse(route: Route, readiness: Readiness) {
  return {
    answerType: "missing_data",
    title: "Data not available yet",
    directAnswer:
      (readiness?.reasons as string[])?.[0] ||
      "This question maps to a metric that is not fully available in NAC Intelligence yet.",
    keyMetrics: [],
    insights: [],
    recommendations: [],
    sources: [],
    warnings: [],
    missingData: (readiness?.missingData as unknown[]) || [],
    confidence: "none",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: (route.period as { rangeId?: string })?.rangeId,
    readiness,
  };
}

function buildUnknownResponse(route: Route) {
  return {
    answerType: "unknown",
    title: "Need a clearer metric question",
    directAnswer:
      "Try asking about menu QR scans, menu sessions, Google redirects, review QR scans, staff redirect leaderboard, branch comparison, or Foodics sales (total sales, top items, categories) for a calendar month.",
    keyMetrics: [],
    insights: [
      "Examples: “How many menu QR scans today?” · “What were sales in May?” · “What were the top 10 items last month?”",
    ],
    recommendations: [],
    sources: [],
    warnings: [],
    missingData: [],
    confidence: "none",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    readiness: { status: "missing" },
  };
}

function buildBlockedResponse(route: Route, readiness: Readiness) {
  return {
    answerType: "error",
    title: "Cannot run this query",
    directAnswer: (readiness?.reasons as string[])?.[0] || "This query is blocked for your role or configuration.",
    keyMetrics: [],
    insights: [],
    recommendations: [],
    sources: [],
    warnings: (readiness?.reasons as string[]) || [],
    missingData: [],
    confidence: "none",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    readiness,
  };
}

function foodicsSources(tool: Tool) {
  return ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail));
}

function foodicsCoverageInsight(tool: Tool) {
  return tool.batchCoverage ? [`Upload batch: ${tool.batchCoverage}`] : [];
}

function foodicsMissingMessageFromTool(tool: Tool) {
  const range = tool?.periodLabel || `${tool?.startDate || ""} – ${tool?.endDate || ""}`;
  return `No Foodics waiter/product sales import covers ${range} for ${tool?.branchLabel || "the selected branch"}.`;
}

function buildFoodicsMissingToolResponse(route: Route, tool: Tool, readiness: Readiness) {
  return buildMissingDataResponse(route, {
    ...readiness,
    reasons: (readiness?.reasons as string[])?.length
      ? readiness?.reasons
      : [
        tool?.missingPeriod
          ? "Could not parse a calendar month or date range for this Foodics question."
          : foodicsMissingMessageFromTool(tool),
      ],
    missingData: (readiness?.missingData as unknown[])?.length
      ? readiness?.missingData
      : [{ intent: route.intent, label: "Foodics sales import", planned: false }],
  });
}

function menuMetricResponse(route: Route, tool: Tool, metricKey: "menuQrScans" | "menuSessions") {
  const isQr = metricKey === "menuQrScans";
  const value = Number(isQr ? tool.menuQrScans : tool.menuSessions) || 0;
  const label = isQr ? "Menu QR Scans" : "Menu Sessions";
  const fields = buildMenuMetricAnswerFields(
    {
      partial: Boolean(tool.partial),
      mtdHybrid: tool.mtdHybrid as Parameters<typeof buildMenuMetricAnswerFields>[0]["mtdHybrid"],
      dataSource: tool.dataSource as string,
      rpc: (tool.sources as { name: string }[])?.[0]?.name,
    },
    {
      label,
      value,
      metricSource: isQr ? "menu_events.funnel.qr_scans" : "menu_events canonical sessions",
      periodLabel: String(tool.periodLabel),
      branchLabel: String(tool.branchLabel),
    },
  );
  return {
    ...fields,
    intent: route.intent,
    confidence: confidenceFromTool(tool, String(route.confidence)),
    recommendations: value === 0
      ? ["No activity in this period — verify branch filter and that guests are scanning the menu QR."]
      : fields.recommendations,
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
  };
}

function reviewMetricResponse(route: Route, tool: Tool, field: "googleRedirects" | "reviewQrScans") {
  const meta = field === "googleRedirects"
    ? { label: "Google Redirects" }
    : { label: "Review QR Scans" };
  const value = Number(tool[field]) || 0;

  return {
    answerType: "metric",
    title: `${meta.label} · ${tool.periodLabel}`,
    directAnswer: `${value.toLocaleString()} ${meta.label.toLowerCase()} for ${tool.branchLabel} (${tool.periodLabel}).`,
    keyMetrics: [metricEntry(meta.label, value, { source: "review_events" })],
    insights: [
      field === "googleRedirects"
        ? "Redirects are intent to review on Google — not published Google reviews."
        : "Review QR scans are review portal entry — separate from menu QR scans.",
    ],
    recommendations: [],
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [...((tool.warnings as string[]) || []), tool.note as string].filter(Boolean),
    missingData: [],
    confidence: confidenceFromTool(tool, String(route.confidence)),
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function staffLeaderboardResponse(route: Route, tool: Tool) {
  const top = (tool.leaderboard as Record<string, unknown>[])?.[0];
  const directAnswer = top
    ? `${top.name} leads with ${top.googleRedirects} Google redirect${top.googleRedirects === 1 ? "" : "s"} (${tool.periodLabel}, ${tool.branchLabel}).`
    : `No staff-attributed redirect activity in ${tool.periodLabel} for ${tool.branchLabel}.`;

  return {
    answerType: "leaderboard",
    title: `Staff redirect leaderboard · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: ((tool.leaderboard as Record<string, unknown>[]) || []).slice(0, 5).map((row, i) =>
      metricEntry(`#${i + 1} ${row.name}`, row.googleRedirects, {
        unit: "redirects",
        note: `${row.reviewQrScans} review QR · ${row.branch || "branch n/a"}`,
      }),
    ),
    insights: top
      ? ["Ranking uses Google redirects attributed to staff on review events."]
      : ["Staff attribution requires employee fields on review events for the period."],
    recommendations: [],
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [...((tool.warnings as string[]) || []), tool.note as string].filter(Boolean),
    missingData: [],
    confidence: top ? confidenceFromTool(tool, String(route.confidence)) : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function branchComparisonResponse(route: Route, tool: Tool) {
  const top = (tool.rows as Record<string, unknown>[])?.[0];
  const directAnswer = top
    ? `${top.branchLabel} leads with ${top.menuSessions} menu sessions (${tool.periodLabel}).`
    : `No branch comparison rows for ${tool.periodLabel}.`;

  return {
    answerType: "comparison",
    title: `Branch comparison · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: ((tool.rows as Record<string, unknown>[]) || []).slice(0, 6).map((row) =>
      metricEntry(String(row.branchLabel), row.menuSessions, {
        unit: "sessions",
        note: `${row.googleRedirects} Google redirects · ${row.reviewQrScans} review QR`,
      }),
    ),
    insights: ["Menu sessions from branch comparison RPC; review metrics merged from review summary."],
    recommendations: [],
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [tool.note as string].filter(Boolean),
    missingData: [],
    confidence: top ? confidenceFromTool(tool, String(route.confidence)) : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    diagnostics: tool.partial ? { partialLive: true, source: "rollup", includesCurrentBusinessDay: false, warnings: [] } : null,
  };
}

function executiveAnalysisResponse(route: Route, tool: Tool) {
  const summary = (tool.summary as Record<string, unknown>) || {};
  const rankingTable = (summary.rankingTable as Record<string, unknown>[]) || [];
  const keyFindings = (summary.keyFindings as string[]) || [];
  const recommendedActions = (summary.recommendedActions as string[]) || [];
  const coverage = (tool.coverageAssessment as Record<string, unknown>) || null;

  if (tool.coverageBlocked) {
    const confidenceLevel = coverage?.confidenceLevel ? String(coverage.confidenceLevel) : "low";
    const confidenceLabel =
      confidenceLevel === "high" ? "High Confidence" : confidenceLevel === "medium" ? "Medium Confidence" : "Low Confidence";

    return {
      answerType: "executive",
      title: "Insufficient network coverage",
      directAnswer: String(summary.headline || "Insufficient data for a valid network-wide comparison."),
      keyMetrics: ((coverage?.branchCoverage as Record<string, unknown>[]) || []).map((row) =>
        metricEntry(String(row.branch_name), row.availableSourceCount, {
          unit: "sources",
          note: row.meaningful ? "Meaningful coverage" : "Limited coverage",
        }),
      ),
      insights: keyFindings.slice(0, 6),
      recommendations: recommendedActions.slice(0, 3),
      sources: [{ name: "dataConfidenceLayer", detail: "coverage assessment before ranking" }],
      warnings: ((coverage?.missingSources as string[]) || []).map((source) => `Missing source: ${source}`),
      missingData: [],
      confidence: "none",
      exportOptions: [],
      isAiGenerated: false,
      intent: route.intent,
      periodLabel: tool.periodLabel,
      dataConfidence: coverage,
      executiveSummary: {
        winner: null,
        reason: (tool.rankingEligibility as Record<string, unknown>)?.reason || null,
        ranking: [],
        keyFindings,
        recommendedActions,
        confidenceLabel,
        coverageScores: coverage
          ? {
              dataCoverageScore: coverage.dataCoverageScore,
              branchCoverageScore: coverage.branchCoverageScore,
              timeCoverageScore: coverage.timeCoverageScore,
              sourceCoverageScore: coverage.sourceCoverageScore,
            }
          : null,
      },
    };
  }

  const keyMetrics =
    tool.analysisKind === "stars_gained"
      ? ((tool.reviewGrowthRows as Record<string, unknown>[]) || []).slice(0, 6).map((row) =>
          metricEntry(String(row.branch_name), row.growth, {
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

  return {
    answerType: "executive",
    title: `Executive summary · ${tool.periodLabel || route.period?.rangeId || "network"}`,
    directAnswer: String(summary.headline || "Executive analysis complete."),
    keyMetrics,
    insights: keyFindings.slice(0, 4),
    recommendations: recommendedActions.slice(0, 3),
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [...((tool.warnings as string[]) || []), tool.note as string].filter(Boolean),
    missingData: [],
    confidence: rankingTable.length || (tool.reviewGrowthRows as unknown[])?.length
      ? confidenceFromTool(tool, String(route.confidence))
      : "low",
    exportOptions: [],
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
        ? String(coverage.confidenceLevel) === "high"
          ? "High Confidence"
          : String(coverage.confidenceLevel) === "medium"
            ? "Medium Confidence"
            : "Low Confidence"
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
  };
}

function operationalKnowledgeResponse(route: Route, tool: Tool) {
  const summary = (tool.summary as Record<string, unknown>) || {};
  return {
    answerType: "executive",
    title: `Operational knowledge · ${tool.periodLabel || "linked reports"}`,
    directAnswer: String(summary.headline || "Operational knowledge graph results."),
    keyMetrics: ((tool.links as Record<string, unknown>[]) || []).slice(0, 6).map((link, index) =>
      metricEntry(`Link ${index + 1}`, link.link_type, {
        note: String(link.link_reason || ""),
      }),
    ),
    insights: [
      ...((summary.linkedReports as string[]) || []),
      ...((tool.repeatedIssues as Record<string, unknown>[]) || []).map(
        (issue) => `${issue.branch}: ${((issue.terms as string[]) || []).join(", ")}`,
      ),
    ].slice(0, 5),
    recommendations: (tool.links as unknown[])?.length
      ? ["Review linked operational reports together before assigning corrective actions."]
      : ["Upload daily logbooks, reception reports, and sales exports for the same period to build links."],
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: (tool.warnings as string[]) || [],
    missingData: [],
    confidence: (tool.links as unknown[])?.length ? "medium" : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function googleReviewCountResponse(route: Route, tool: Tool) {
  const delta = tool.reviewDelta;
  const deltaLabel = delta == null ? null : delta > 0 ? `+${delta}` : String(delta);
  const directAnswer =
    delta != null
      ? `${tool.branchLabel} ${deltaLabel} published Google reviews in ${tool.periodLabel}. Current total: ${tool.currentReviewCount ?? "—"}.`
      : `Google review snapshot history is not available for ${tool.periodLabel}.`;

  return {
    answerType: "metric",
    title: `Google reviews · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: [
      metricEntry("Review delta", delta ?? "—", { unit: "reviews", source: "google_review_snapshots" }),
      metricEntry("Current total", tool.currentReviewCount ?? "—", { unit: "reviews" }),
    ],
    insights: [],
    recommendations: [],
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: (tool.warnings as string[]) || [],
    missingData: [],
    confidence: delta != null ? confidenceFromTool(tool, String(route.confidence)) : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function foodicsSalesTotalResponse(route: Route, tool: Tool) {
  const totals = (tool.totals as Record<string, number>) || {};
  return {
    answerType: "metric",
    title: `Foodics sales · ${tool.periodLabel}`,
    directAnswer: `${formatSar(totals.netSales)} net sales for ${tool.branchLabel} (${tool.periodLabel}).`,
    keyMetrics: [
      metricEntry("Net sales", totals.netSales, { unit: "SAR", source: "foodics_sales_items.net_sales" }),
      metricEntry("Gross sales", totals.grossSales, { unit: "SAR", source: "foodics_sales_items.gross_sales" }),
      metricEntry("Units sold", totals.quantity, { source: "foodics_sales_items.quantity_sold" }),
    ],
    insights: [...foodicsCoverageInsight(tool), "Totals come from uploaded Foodics waiter/product sales — not menu QR views."],
    recommendations: [],
    sources: foodicsSources(tool),
    warnings: (tool.warnings as string[]) || [],
    missingData: [],
    confidence: "high",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function foodicsTopItemsResponse(route: Route, tool: Tool) {
  const basis = (tool.rankingLabel as string) || "net sales";
  const top = (tool.topItems as Record<string, unknown>[])?.[0];
  const directAnswer = top
    ? `#1 by ${basis}: ${top.itemName} (${basis === "quantity sold" ? `${top.quantity} units` : formatSar(top.netSales)}) for ${tool.periodLabel}.`
    : `No ranked items found for ${tool.periodLabel} (${tool.branchLabel}).`;

  return {
    answerType: "leaderboard",
    title: `Top items by ${basis} · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: ((tool.topItems as Record<string, unknown>[]) || []).map((row) =>
      metricEntry(`#${row.rank} ${row.itemName}`, tool.rankingBasis === "quantity" ? row.quantity : row.netSales, {
        unit: tool.rankingBasis === "quantity" ? "units" : "SAR",
        note: String(row.category || ""),
      }),
    ),
    insights: foodicsCoverageInsight(tool),
    recommendations: [],
    sources: foodicsSources(tool),
    warnings: (tool.warnings as string[]) || [],
    missingData: [],
    confidence: top ? "high" : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function foodicsCompareResponse(route: Route, tool: Tool) {
  const basis = tool.rankingBasis === "quantity" ? "quantity" : "net sales";
  const compare = tool.compare as { current?: { label?: string }; previous?: { label?: string } } | undefined;
  const currentLabel = compare?.current?.label || tool.periodLabel;
  const previousLabel = compare?.previous?.label || "previous period";
  const entered = (tool.entered as Record<string, unknown>[]) || [];
  const dropped = (tool.dropped as Record<string, unknown>[]) || [];
  const rankChangeDirection = route.rankChangeDirection || "both";
  const limit = Number(tool.limit) || 10;

  let directAnswer = "";
  if (route.intent === "item_rank_change") {
    if (rankChangeDirection === "entered") {
      directAnswer = entered.length
        ? `${entered.map((r) => r.itemName).join(", ")} entered the top ${limit} by ${basis} (${currentLabel} vs ${previousLabel}).`
        : `No items newly entered the top ${limit} by ${basis} (${currentLabel} vs ${previousLabel}).`;
    } else if (rankChangeDirection === "dropped") {
      directAnswer = dropped.length
        ? `${dropped.map((r) => r.itemName).join(", ")} dropped from the top ${limit} by ${basis} (${previousLabel} vs ${currentLabel}).`
        : `No items dropped from the top ${limit} by ${basis} (${previousLabel} vs ${currentLabel}).`;
    } else {
      const parts: string[] = [];
      if (entered.length) parts.push(`Entered: ${entered.map((r) => r.itemName).join(", ")}`);
      if (dropped.length) parts.push(`Dropped: ${dropped.map((r) => r.itemName).join(", ")}`);
      directAnswer = parts.length
        ? `${parts.join(". ")}.`
        : `No top-${limit} rank changes by ${basis} between ${previousLabel} and ${currentLabel}.`;
    }
  } else {
    directAnswer = `Compared top ${limit} items by ${basis}: ${currentLabel} vs ${previousLabel}.`;
  }

  const keyMetrics: ReturnType<typeof metricEntry>[] = [];
  if (route.intent === "item_rank_change") {
    const rows = rankChangeDirection === "dropped" ? dropped : rankChangeDirection === "entered" ? entered : [...entered, ...dropped];
    rows.forEach((row) => {
      keyMetrics.push(
        metricEntry(String(row.itemName), tool.rankingBasis === "quantity" ? row.quantity : row.netSales, {
          unit: tool.rankingBasis === "quantity" ? "units" : "SAR",
          note: entered.includes(row) ? "Entered top list" : "Dropped from top list",
        }),
      );
    });
  } else {
    ((tool.currentTop as Record<string, unknown>[]) || []).slice(0, limit).forEach((row) => {
      keyMetrics.push(
        metricEntry(`#${row.rank} ${row.itemName}`, tool.rankingBasis === "quantity" ? row.quantity : row.netSales, {
          unit: tool.rankingBasis === "quantity" ? "units" : "SAR",
          note: String(currentLabel),
        }),
      );
    });
  }

  return {
    answerType: "comparison",
    title: route.intent === "item_rank_change" ? `Top ${limit} rank change · ${basis}` : `Top items compare · ${basis}`,
    directAnswer,
    keyMetrics,
    insights: [
      ...foodicsCoverageInsight(tool),
      tool.previousBatchCoverage ? `Previous period batch: ${tool.previousBatchCoverage}` : null,
    ].filter(Boolean) as string[],
    recommendations: [],
    sources: foodicsSources(tool),
    warnings: (tool.warnings as string[]) || [],
    missingData: [],
    confidence: "high",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: currentLabel,
    branchLabel: tool.branchLabel,
  };
}

function foodicsCategoryResponse(route: Route, tool: Tool) {
  const top = tool.topCategory as Record<string, unknown> | null;
  const directAnswer = top
    ? `${top.category} generated the most revenue (${formatSar(top.netSales)}) in ${tool.periodLabel} for ${tool.branchLabel}.`
    : `No category sales found for ${tool.periodLabel}.`;

  return {
    answerType: "comparison",
    title: `Category sales · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: ((tool.categories as Record<string, unknown>[]) || []).slice(0, 10).map((row) =>
      metricEntry(String(row.category), row.netSales, { unit: "SAR", note: `${row.quantity} units` }),
    ),
    insights: foodicsCoverageInsight(tool),
    recommendations: [],
    sources: foodicsSources(tool),
    warnings: (tool.warnings as string[]) || [],
    missingData: [],
    confidence: top ? "high" : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
    branchLabel: tool.branchLabel,
  };
}

function foodicsBranchSalesResponse(route: Route, tool: Tool) {
  const top = (tool.branches as Record<string, unknown>[])?.[0];
  const directAnswer = top
    ? `${top.branchLabel} leads with ${formatSar(top.netSales)} net sales (${tool.periodLabel}).`
    : `No branch Foodics batches overlap ${tool.periodLabel}.`;

  return {
    answerType: "comparison",
    title: `Branch sales · ${tool.periodLabel}`,
    directAnswer,
    keyMetrics: ((tool.branches as Record<string, unknown>[]) || []).map((row) =>
      metricEntry(String(row.branchLabel), row.netSales, {
        unit: "SAR",
        note: `${row.quantity} units · ${row.batchCoverage || ""}`,
      }),
    ),
    insights: ["Each branch total uses its own overlapping Foodics import batch for the period."],
    recommendations: [],
    sources: ((tool.sources as { name: string; detail?: string }[]) || []).map((s) => sourceEntry(s.name, s.detail)),
    warnings: [],
    missingData: [],
    confidence: top ? "high" : "low",
    exportOptions: [],
    isAiGenerated: false,
    intent: route.intent,
    periodLabel: tool.periodLabel,
  };
}

export function buildDeterministicAskNacAnswer(route: Route, tool: Tool | null, readiness: Readiness) {
  if (readiness?.status === "blocked") return buildBlockedResponse(route, readiness);
  if (route.intent === "unknown") return buildUnknownResponse(route);
  if (readiness?.status === "missing" && !readiness.canQuery) return buildMissingDataResponse(route, readiness);
  if (isVaultDataIntent(route.intent) || isVaultDocumentIntent(route.intent)) {
    return buildVaultAnswer(route, tool, readiness);
  }
  if (!tool) {
    return buildBlockedResponse(route, {
      status: "blocked",
      reasons: ["Query tool returned no data for this route. The document or report may exist, but no matching structured result was produced."],
    });
  }
  if (tool.missingBatch || tool.missingPeriod) return buildFoodicsMissingToolResponse(route, tool, readiness);

  switch (route.intent) {
    case "menu_qr_scans":
      return menuMetricResponse(route, tool, "menuQrScans");
    case "menu_sessions":
      return menuMetricResponse(route, tool, "menuSessions");
    case "google_redirects":
      return reviewMetricResponse(route, tool, "googleRedirects");
    case "review_qr_scans":
      return reviewMetricResponse(route, tool, "reviewQrScans");
    case "staff_redirect_leaderboard":
      return staffLeaderboardResponse(route, tool);
    case "branch_comparison":
      return branchComparisonResponse(route, tool);
    case "executive_analysis":
      return executiveAnalysisResponse(route, tool);
    case "operational_knowledge":
      return operationalKnowledgeResponse(route, tool);
    case "google_reviews":
      return googleReviewCountResponse(route, tool);
    case "sales_total":
      return foodicsSalesTotalResponse(route, tool);
    case "top_items":
      return foodicsTopItemsResponse(route, tool);
    case "top_items_compare":
    case "item_rank_change":
      return foodicsCompareResponse(route, tool);
    case "category_sales":
      return foodicsCategoryResponse(route, tool);
    case "branch_sales":
      return foodicsBranchSalesResponse(route, tool);
    default:
      return buildMissingDataResponse(route, readiness || { missingData: [], reasons: ["Unsupported intent."] });
  }
}

export function periodLabelFromHours(hours: number) {
  if (hours === 999 || hours === 720) return "Month-to-date";
  if (hours >= 168) return "Last 7 days";
  return "Today";
}

export { branchDisplayName, MAX_STAFF_ROWS, MAX_BRANCH_ROWS };
