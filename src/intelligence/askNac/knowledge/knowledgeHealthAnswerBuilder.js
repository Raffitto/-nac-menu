/**
 * Format Knowledge Health answers for Ask NAC.
 */

import { createAskNacResponse, ANSWER_TYPES } from "../askNacContract";
import { detectKnowledgeHealthFocus } from "./knowledgeHealthEngine";

function formatRegistrySection(registry = {}) {
  const lines = [];
  const pushList = (title, items, fmt) => {
    if (!items?.length) return;
    lines.push(`${title}:`);
    for (const item of items.slice(0, 6)) {
      lines.push(`• ${fmt(item)}`);
    }
    if (items.length > 6) lines.push(`• …and ${items.length - 6} more`);
  };

  pushList("Missing reports", registry.missingReports, (i) => `${i.label} — ${i.reason}`);
  pushList("Missing / empty dates", registry.missingDates, (i) => `${i.label} (${i.date || "n/a"}) — ${i.reason}`);
  pushList("Failed extractions", registry.failedExtractions, (i) => `${i.fileTitle}: ${i.error}`);
  pushList("Missing manual inputs", registry.missingManualInputs, (i) => i.label);
  pushList("Pending sessions", registry.pendingSessions, (i) => `${i.sessionType}: ${(i.missingFields || []).join(", ")}`);
  pushList("Unapproved Drive folders", registry.unapprovedFolders, (i) => `${i.folderPath} (${i.detectedReportType})`);
  pushList("Informational gaps (optional)", registry.informationalGaps, (i) => `${i.label} — ${i.reason}`);

  return lines.length ? lines.join("\n") : "No gaps flagged in the missing-information registry for this scope.";
}

function formatRecommendations(recommendations = []) {
  if (!recommendations.length) return "No remediation steps required for the assessed scope.";
  return recommendations.slice(0, 8).map((r, i) =>
    `${i + 1}. ${r.what}\n   Why it matters: ${r.why}\n   How to fix: ${r.how}`,
  ).join("\n\n");
}

function formatDomainReadiness(domainReadiness = []) {
  if (!domainReadiness.length) return "";
  return [
    "Domain readiness (taxonomy foundation):",
    ...domainReadiness.map((d) => `• ${d.label}: ${d.productionScored ? "production-scored" : d.status}${d.storedFileCount ? ` (${d.storedFileCount} files)` : ""} — ${d.detail}`),
  ].join("\n");
}

function formatComponentScores(components = {}) {
  const labels = {
    coverageCompleteness: "Coverage completeness",
    ingestionSuccess: "Ingestion success",
    parserSuccess: "Parser success",
    dashboardReadiness: "Dashboard readiness",
    executiveIntelligenceReadiness: "Executive intelligence readiness",
  };
  return Object.entries(components)
    .map(([key, value]) => `• ${labels[key] || key}: ${value == null ? "n/a (no jobs)" : `${value}%`}`)
    .join("\n");
}

export function buildKnowledgeHealthAnswer(route, tool, readiness) {
  const health = tool?.knowledgeHealth || tool;
  const focus = tool?.focus || detectKnowledgeHealthFocus(route?.question || "");
  const branchLabel = health.branchLabel || "Network";
  const periodLabel = health.periodLabel || route?.vaultPeriod?.label || "current period";
  const score = health.overallScore ?? 0;

  let directAnswer = "";
  let title = `Knowledge Health · ${branchLabel}`;

  if (focus === "dashboard") {
    const dr = health.componentDetail?.dashboardReadiness || {};
    const history = dr.dashboardHistoryDepth;
    title = `Dashboard Readiness · ${branchLabel}`;
    directAnswer = [
      `Weekly Dashboard Readiness: ${dr.score ?? health.components?.dashboardReadiness ?? 0}%`,
      dr.missing?.length ? `\nMissing:\n${dr.missing.map((m) => `• ${m}`).join("\n")}` : "\nAll scored dashboard checklist items satisfied for the assessed period.",
      history ? `\nDashboard history depth: ${history.depthLabel}` : "",
      dr.checks?.length
        ? `\nChecklist:\n${dr.checks.map((c) => `• ${c.label}: ${c.satisfied ? "✓" : "✗"} (${c.detail})`).join("\n")}`
        : "",
    ].filter(Boolean).join("");
  } else if (focus === "confidence") {
    const er = health.componentDetail?.executiveReadiness || {};
    title = `Executive Intelligence Readiness · ${branchLabel}`;
    directAnswer = [
      `Executive intelligence readiness: ${er.score ?? health.components?.executiveIntelligenceReadiness ?? 0}%`,
      er.confidenceReductionReasons?.length
        ? `\nWhy-analysis confidence is reduced because:\n${er.confidenceReductionReasons.map((r) => `• ${r}`).join("\n")}`
        : "\nCore executive sources (cash-up + logbook) are indexed for this period.",
      er.present?.length ? `\nIndexed (core): ${er.present.join("; ")}` : "",
      er.optionalAvailable?.length ? `\nOptional sources available: ${er.optionalAvailable.join("; ")}` : "",
      er.optionalInactive?.length ? `\nOptional / inactive: ${er.optionalInactive.join("; ")}` : "",
    ].filter(Boolean).join("");
  } else if (focus === "missing") {
    title = `Missing Information · ${branchLabel}`;
    directAnswer = [
      `Missing information registry for ${periodLabel}:`,
      "",
      formatRegistrySection(health.missingRegistry),
      "",
      "Recommendations:",
      formatRecommendations(health.recommendations),
    ].join("\n");
  } else {
    directAnswer = [
      `Knowledge Health Score for ${branchLabel} (${periodLabel}): ${score}/100`,
      "",
      "Component scores:",
      formatComponentScores(health.components),
      "",
      `Dashboard readiness: ${health.components?.dashboardReadiness ?? 0}%`,
      health.componentDetail?.dashboardReadiness?.missing?.length
        ? `Missing for dashboard: ${health.componentDetail.dashboardReadiness.missing.join("; ")}`
        : "",
      health.componentDetail?.dashboardReadiness?.dashboardHistoryDepth
        ? `Dashboard history: ${health.componentDetail.dashboardReadiness.dashboardHistoryDepth.depthLabel}`
        : "",
      "",
      `Executive intelligence readiness: ${health.components?.executiveIntelligenceReadiness ?? 0}%`,
      health.componentDetail?.executiveReadiness?.confidenceReductionReasons?.length
        ? `Confidence reduced by: ${health.componentDetail.executiveReadiness.confidenceReductionReasons.join("; ")}`
        : "",
      "",
      formatDomainReadiness(health.domainReadiness),
      "",
      "Missing information registry:",
      formatRegistrySection(health.missingRegistry),
      "",
      "Recommendations:",
      formatRecommendations(health.recommendations),
    ].join("\n");
  }

  if (health.disclosures?.length) {
    directAnswer += `\n\nDisclosure:\n${health.disclosures.map((d) => `• ${d}`).join("\n")}`;
  }

  const confidence = score >= 80 ? "high" : score >= 55 ? "medium" : "low";

  return createAskNacResponse({
    intent: route.intent,
    answerType: ANSWER_TYPES.EXECUTIVE,
    title,
    directAnswer,
    confidence,
    recommendations: (health.recommendations || []).map((r) => `${r.what}: ${r.how}`),
    diagnostics: {
      knowledgeHealth: true,
      overallScore: score,
      components: health.components,
      missingRegistry: health.missingRegistry,
      focus,
    },
    sources: health.sources || tool?.sources || [],
    readiness,
  });
}
