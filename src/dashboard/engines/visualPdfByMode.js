import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { businessDayExportNote } from "../utils/businessDay";
import { exportCell } from "../utils/intelligenceSanity";
import { waiterSalesValue } from "../utils/waiterSalesMetric";
import {
  fillPage,
  newPage,
  sectionOn,
  drawPageTitle,
  drawKpiCard,
  drawHBar,
  embedChart,
  drawInsightCard,
  drawCover,
  salesMetricFromPayload,
  NAC_TEAL,
  NAC_GOLD,
  NAC_WHITE,
  CARD_BG,
} from "./pdfVisualTheme";
import {
  drawExecutiveSummaryPage,
  drawAwardsGrid,
  drawCoachingCard,
  drawOpsSection,
} from "./pdfExecutivePages";
import { appendOperationalVisualPages } from "./pdfVisualIntelligencePages";
import { buildOperationalVisualBundle } from "./waiterVisualEngine";
import {
  drawFinancialOpportunityPage,
  drawStaffPerformancePage,
  drawMenuVisibilitySignalsPage,
} from "./executivePdfLayout";
import {
  formatAttachmentOpportunityTableRow,
  ATTACHMENT_PROXY_DISCLAIMER,
} from "./attachmentOpportunityCopy";
import { EXECUTIVE_LABELS, MENU_QUADRANT_COPY } from "../config/executiveVisualLanguage";

function baseCtx(payload) {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  const branch = payload.exportMeta?.branch || "all";
  const period = payload.exportMeta?.period || businessDayExportNote();
  const salesMetric = salesMetricFromPayload(payload);
  const metricLabel = salesMetric === "net" ? "Net Sales" : "Gross Sales";
  return { doc, margin, contentW, branch, period, salesMetric, metricLabel };
}

function savePdf(doc, mode, branch) {
  doc.save(`nac-${mode}-${branch}.pdf`);
}

function visualBundleMeta(waiters, salesMetric) {
  const b = buildOperationalVisualBundle(waiters || [], salesMetric);
  return { volumeRisk: b.volumeRisk, qualityLeader: b.qualityLeader, opportunity: b.opportunity };
}

/** Weekly staff — executive summary, awards, unique coaching */
function exportWeeklyStaffPDF(payload) {
  const {
    waiters,
    waiterTargets,
    staffAwards,
    executiveSummary,
    opsInsights,
    sections = {},
    chartImages = {},
    financial = {},
  } = payload;
  const { doc, margin, contentW, branch, period, salesMetric, metricLabel } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Weekly Staff Intelligence",
    subtitle: "Hospitality operational intelligence · commercial priorities",
    meta: `${branch.toUpperCase()} · ${period} · ${metricLabel}`,
    blurb: "Executive operational intelligence — not generic AI summaries. Coaching respects breakfast vs PM shifts and premium beverage economics.",
  });

  if (executiveSummary) {
    doc.addPage();
    drawExecutiveSummaryPage(doc, margin, contentW, executiveSummary, period);
  }

  if (financial?.totalRecoverable > 0) {
    doc.addPage();
    drawFinancialOpportunityPage(doc, margin, contentW, financial);
  }

  const visualWaiters = waiters?.waiters || [];
  const vMeta = visualBundleMeta(visualWaiters, salesMetric);
  if (visualWaiters.length && (chartImages.rqScatter || chartImages.bevMixStacked)) {
    appendOperationalVisualPages(doc, margin, contentW, chartImages, vMeta.opportunity, vMeta);
  }

  doc.addPage();
  fillPage(doc);
  let y = margin + 20;
  if (staffAwards?.awards?.length) {
    y = drawAwardsGrid(doc, margin, y, contentW, staffAwards.awards);
  }

  if (sectionOn(sections, "waiter") && waiters?.waiters?.length) {
    doc.addPage();
    drawStaffPerformancePage(doc, margin, contentW, visualWaiters, chartImages, salesMetric);
  }

  if (waiterTargets?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Operational coaching", "Unique per waiter · shift-aware");
    waiterTargets.forEach((c, i) => {
      y = drawCoachingCard(doc, margin, y, contentW, c, i + 1);
    });
  }

  if (opsInsights) {
    doc.addPage();
    fillPage(doc);
    y = margin + 20;
    y = drawOpsSection(doc, margin, y, contentW, "Strategic operational risks", opsInsights.risks, "risk");
    y = drawOpsSection(doc, margin, y, contentW, "Commercial opportunities", opsInsights.wins, "win");
  }

  savePdf(doc, "weekly-staff-targets", branch);
}

/** Manager review — ops issues, reviews/menu/sales balance */
function exportManagerReviewPDF(payload) {
  const {
    attachment,
    timeShift,
    heat,
    menuEngineering,
    waiters,
    sortedProducts,
    menuVisibility,
    insights,
    kpis,
    sections = {},
    chartImages = {},
    financial = {},
  } = payload;
  const { doc, margin, contentW, branch, period, salesMetric, metricLabel } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Manager Review Report",
    subtitle: "Commercial intelligence · monetization leakage · staff behavior",
    meta: `${branch.toUpperCase()} · ${period}`,
    blurb: "Balanced ops view for GMs: attachment gaps, daypart peaks, staff outliers, and menu risks.",
  });

  const mgrWaiters = waiters?.waiters || [];
  const mgrMeta = visualBundleMeta(mgrWaiters, salesMetric);
  if (mgrWaiters.length && chartImages.rqScatter) {
    appendOperationalVisualPages(doc, margin, contentW, chartImages, mgrMeta.opportunity, mgrMeta);
  }

  if (financial?.totalRecoverable > 0) {
    doc.addPage();
    drawFinancialOpportunityPage(doc, margin, contentW, financial);
  }

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Management priorities", metricLabel);

  const kpiW = (contentW - 16) / 3;
  [
    [EXECUTIVE_LABELS.revenueAtRisk, `${Math.round(financial?.attachmentLeakage || 0).toLocaleString()} SAR`],
    [EXECUTIVE_LABELS.beverageOpportunity, `${Math.round(financial?.beverageOpportunity || 0).toLocaleString()} SAR`],
    ["Peak daypart", timeShift?.peakDaypart?.label || "—"],
  ].forEach(([label, val], i) => {
    drawKpiCard(doc, margin + i * (kpiW + 8), y, kpiW, 48, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
  });
  y += 58;

  if (sectionOn(sections, "missed") && attachment?.missedUpsells?.length) {
    doc.setTextColor(...NAC_GOLD);
    doc.setFontSize(10);
    doc.text("Monetization leakage — proxy attachment gaps", margin, y);
    y += 12;
    autoTable(doc, {
      startY: y,
      head: [["Opportunity", "Proxy attach", "Target", "Est. upside SAR"]],
      body: attachment.missedUpsells.slice(0, 10).map((m) => formatAttachmentOpportunityTableRow(m)),
      styles: { fontSize: 8, textColor: NAC_WHITE, fillColor: CARD_BG },
      headStyles: { fillColor: [120, 50, 40] },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.splitTextToSize(ATTACHMENT_PROXY_DISCLAIMER, contentW).forEach((ln, i) => {
      doc.text(ln, margin, y + i * 9);
    });
    y += 20;
  }

  if (sectionOn(sections, "waiter") && mgrWaiters.length) {
    doc.addPage();
    drawStaffPerformancePage(doc, margin, contentW, mgrWaiters, chartImages, salesMetric);
    y = margin + 20;
  }

  if (sectionOn(sections, "product") && (menuVisibility?.rows?.length || sortedProducts?.length)) {
    doc.addPage();
    y = drawMenuVisibilitySignalsPage(doc, margin, contentW, menuVisibility);
  }

  if (
    sectionOn(sections, "menuEng") &&
    menuEngineering?.length &&
    !menuVisibility?.hideMenuEngineeringQuadrant
  ) {
    if (y > 600) {
      doc.addPage();
      fillPage(doc);
      y = margin + 20;
    }
    doc.setTextColor(...NAC_GOLD);
    doc.setFontSize(10);
    doc.text("Menu engineering quadrant", margin, y);
    y += 14;
    const quadrants = { Star: [], Puzzle: [], Workhorse: [], Dog: [] };
    menuEngineering.forEach((m) => {
      if (quadrants[m.quadrant]) quadrants[m.quadrant].push(m);
    });
    ["Star", "Puzzle", "Workhorse", "Dog"].forEach((q) => {
      if (!quadrants[q].length) return;
      doc.setFontSize(9);
      doc.setTextColor(...(q === "Star" ? NAC_TEAL : NAC_GOLD));
      doc.text(`${q}s (${quadrants[q].length})`, margin, y);
      y += 12;
      quadrants[q].slice(0, 3).forEach((m) => {
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        const orderNote =
          (m.orders || 0) > 0
            ? `${m.orders} menu orders`
            : "menu orders not matched to Foodics";
        doc.text(`· ${m.item_name} — ${orderNote}`, margin + 8, y);
        y += 11;
      });
      y += 4;
    });
  }

  if (sectionOn(sections, "ai") && insights?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, EXECUTIVE_LABELS.strategicSignals, "Prioritized for general manager review");
    insights.forEach((ins) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: ins.confidence === "high" ? "high" : "medium",
        category: ins.type,
        title: ins.title,
        body: ins.body,
      });
    });
  }

  if (kpis?.sessions) {
    drawKpiCard(doc, margin, 720, contentW / 2 - 4, 36, "Menu sessions", kpis.sessions, NAC_TEAL);
    drawKpiCard(doc, margin + contentW / 2 + 4, 720, contentW / 2 - 4, 36, "Heat leaders", heat?.hotNow?.length || 0, NAC_GOLD);
  }

  savePdf(doc, "manager-review", branch);
}

/** Executive boardroom — KPIs, revenue, risks, opportunities */
function exportExecutiveBoardroomPDF(payload) {
  const {
    attachment,
    heat,
    menuEngineering,
    waiters,
    insights,
    kpis,
    executiveSummary,
    staffAwards,
    opsInsights,
    sections = {},
    chartImages = {},
    financial = {},
  } = payload;
  const { doc, margin, contentW, branch, period, salesMetric, metricLabel } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Executive Boardroom Report",
    subtitle: "Commercial intelligence · recoverable value · strategic signals",
    meta: `${branch.toUpperCase()} · ${period}`,
    blurb: "Board-ready operational intelligence with revenue impact, beverage mix economics, and shift-aware staff signals.",
  });

  if (executiveSummary) {
    doc.addPage();
    drawExecutiveSummaryPage(doc, margin, contentW, executiveSummary, period);
  }

  const execWaiters = waiters?.waiters || [];
  const execMeta = visualBundleMeta(execWaiters, salesMetric);
  if (execWaiters.length && (chartImages.rqScatter || chartImages.bevMixStacked)) {
    appendOperationalVisualPages(doc, margin, contentW, chartImages, execMeta.opportunity, execMeta);
  }

  if (financial?.totalRecoverable > 0) {
    doc.addPage();
    drawFinancialOpportunityPage(doc, margin, contentW, financial);
  }

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Executive KPIs", period);

  const kpiW = (contentW - 24) / 4;
  const topWaiter = waiters?.topUpseller;
  const topSales = topWaiter ? waiterSalesValue(topWaiter, salesMetric) : 0;

  [
    [EXECUTIVE_LABELS.recoverableOpportunity, `${Math.round(financial?.totalRecoverable || 0).toLocaleString()} SAR`],
    [EXECUTIVE_LABELS.attachmentLeakage, `${Math.round(financial?.attachmentLeakage || 0).toLocaleString()} SAR`],
    [EXECUTIVE_LABELS.beverageOpportunity, `${Math.round(financial?.beverageOpportunity || 0).toLocaleString()} SAR`],
    ["Menu sessions", String(kpis?.sessions ?? "—")],
  ].forEach(([label, val], i) => {
    drawKpiCard(doc, margin + i * (kpiW + 8), y, kpiW, 52, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
  });
  y += 66;

  if (topWaiter) {
    drawKpiCard(doc, margin, y, contentW / 2 - 4, 44, `Top performer (${metricLabel})`, topWaiter.waiter, NAC_GOLD);
    drawKpiCard(doc, margin + contentW / 2 + 4, y, contentW / 2 - 4, 44, "Top sales", `${topSales.toLocaleString()} SAR`, NAC_TEAL);
    y += 54;
  }

  if (staffAwards?.awards?.length) {
    y = drawAwardsGrid(doc, margin, y + 8, contentW, staffAwards.awards.slice(0, 6));
  }

  y = embedChart(doc, chartImages.hourlySales, margin, y + 8, contentW, 110) || y;

  doc.addPage();
  fillPage(doc);
  y = margin + 20;
  if (opsInsights) {
    y = drawOpsSection(doc, margin, y, contentW, "Strategic risks", opsInsights.risks, "risk");
    y = drawOpsSection(doc, margin, y, contentW, "Strategic opportunities", opsInsights.wins, "win");
  } else {
    y = drawPageTitle(doc, margin, "Strategic signals", "");
    (insights || []).slice(0, 5).forEach((ins) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: ins.confidence === "high" ? "high" : "medium",
        category: ins.type,
        title: ins.title,
        body: ins.body,
      });
    });
  }

  if (sectionOn(sections, "missed") && attachment?.missedUpsells?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Revenue at risk", "Missed modifier / upsell opportunities");
    attachment.missedUpsells.slice(0, 6).forEach((m) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: m.opportunityScore >= 50 ? "high" : "medium",
        category: "Missed upsell",
        title: m.label,
        body: m.exportBody || `${m.attachmentRate}% proxy attach vs ${m.expectedPct}% target`,
      });
    });
  }

  if (sectionOn(sections, "heat") && heat?.hotNow?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Momentum (heat leaders)", "Items gaining traction");
    heat.hotNow.slice(0, 8).forEach((h) => {
      doc.setTextColor(...NAC_WHITE);
      doc.setFontSize(9);
      doc.text(`${h.item_name} — heat ${h.heatIndex}`, margin, y);
      drawHBar(doc, margin + 140, y - 6, contentW - 160, 8, h.heatPct || 50, NAC_GOLD);
      y += 22;
    });
  }

  const stars = (menuEngineering || []).filter((m) => m.quadrant === "Star").slice(0, 5);
  if (stars.length) {
    if (y > 640) {
      doc.addPage();
      fillPage(doc);
      y = margin + 20;
    }
    doc.setTextColor(...NAC_GOLD);
    doc.setFontSize(10);
    doc.text("Star performers (menu engineering)", margin, y);
    y += 14;
    stars.forEach((m) => {
      doc.setFontSize(8);
      doc.setTextColor(200, 200, 200);
      doc.text(`· ${m.item_name} — ${m.orders} orders`, margin + 8, y);
      y += 12;
    });
  }

  savePdf(doc, "executive-boardroom", branch);
}

/** Menu engineering — visibility, conversion, quadrant, heat */
function exportMenuEngineeringPDF(payload) {
  const {
    attachment,
    heat,
    menuEngineering,
    sortedProducts,
    insights,
    sections = {},
    chartImages = {},
  } = payload;
  const { doc, margin, contentW, branch, period } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Menu Engineering Report",
    subtitle: "Strategic menu intelligence · quadrant · momentum · monetization",
    meta: `${branch.toUpperCase()} · ${period}`,
    blurb: "BCG positioning with operational interpretation — stars to protect, puzzles to unlock, workhorses to pair with premium attach, dogs to simplify.",
  });

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Menu positioning map", "Popularity × profitability — strategic quadrants");

  y = embedChart(doc, chartImages.menuScatter, margin, y, contentW, 150) || y;

  const quadrants = { Star: [], Puzzle: [], Workhorse: [], Dog: [] };
  (menuEngineering || []).forEach((m) => {
    if (quadrants[m.quadrant]) quadrants[m.quadrant].push(m);
  });

  ["Star", "Puzzle", "Workhorse", "Dog"].forEach((q) => {
    if (!quadrants[q].length) return;
    if (y > 640) {
      doc.addPage();
      fillPage(doc);
      y = margin + 24;
    }
    const copy = MENU_QUADRANT_COPY[q];
    doc.setTextColor(...(q === "Star" ? NAC_TEAL : q === "Puzzle" ? [245, 166, 35] : NAC_GOLD));
    doc.setFontSize(10);
    doc.text(`${copy?.title || q} (${quadrants[q].length})`, margin, y);
    y += 12;
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.splitTextToSize(copy?.body || "", contentW).slice(0, 2).forEach((ln, i) => {
      doc.text(ln, margin, y + i * 10);
    });
    y += 24;
    quadrants[q].slice(0, 5).forEach((m) => {
      doc.setFontSize(9);
      doc.setTextColor(200, 200, 200);
      doc.text(`· ${m.item_name} — ${m.orders} orders · ${m.views} views`, margin + 8, y);
      y += 12;
    });
    y += 8;
  });

  if (sectionOn(sections, "heat")) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Heat score leaders", "Momentum vs baseline");
    y = embedChart(doc, chartImages.heatScore, margin, y, contentW, 130) || y;
    (heat?.hotNow || []).slice(0, 10).forEach((h) => {
      if (y > 700) y = newPage(doc, margin);
      doc.setFontSize(9);
      doc.setTextColor(...NAC_WHITE);
      doc.text(`${h.item_name} — index ${h.heatIndex}`, margin, y);
      drawHBar(doc, margin + 160, y - 6, contentW - 180, 10, h.heatPct || 50, NAC_GOLD);
      y += 24;
    });
  }

  if (sectionOn(sections, "product") && sortedProducts?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Product ranking", "Heat · orders · views");
    autoTable(doc, {
      startY: y,
      head: [["Product", "Heat", "Orders", "Views", "Tag"]],
      body: sortedProducts.slice(0, 14).map((p) => [
        exportCell(p.item_name),
        String(p.heatIndex ?? "—"),
        String(p.orders ?? "—"),
        String(p.views ?? "—"),
        p.tag || "—",
      ]),
      styles: { fontSize: 9, textColor: NAC_WHITE, fillColor: CARD_BG },
      headStyles: { fillColor: NAC_TEAL },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  if (sectionOn(sections, "attachment") && attachment?.pairs?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Attachment monetization intelligence", "Largest commercial leaks on the menu");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text("Prioritized by premium positioning and margin — not raw spreadsheet gaps.", margin, y + 2);
    y += 16;
    attachment.pairs
      .filter((p) => p.attachedOrders > 0)
      .slice(0, 10)
      .forEach((p) => {
        if (y > 720) return;
        doc.setFontSize(9);
        doc.setTextColor(...NAC_WHITE);
        doc.text(`${p.label}: ${p.attachmentRate}% (target ${p.expectedPct}%)`, margin, y);
        drawHBar(doc, margin, y + 6, contentW, 8, (p.attachmentRate / Math.max(p.expectedPct, 1)) * 100, NAC_TEAL);
        y += 24;
      });
  }

  if (sectionOn(sections, "ai") && insights?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Strategic menu signals", "Commercial intelligence");
    insights
      .filter((i) => ["product", "menu", "heat", "attachment"].includes(i.type) || !i.type)
      .slice(0, 6)
      .forEach((ins) => {
        if (y > 700) y = newPage(doc, margin);
        y = drawInsightCard(doc, margin, y, {
          severity: ins.confidence === "high" ? "high" : "medium",
          category: ins.type,
          title: ins.title,
          body: ins.body,
        });
      });
  }

  savePdf(doc, "menu-engineering", branch);
}

const MODE_EXPORTERS = {
  weekly_staff: exportWeeklyStaffPDF,
  manager_review: exportManagerReviewPDF,
  executive_boardroom: exportExecutiveBoardroomPDF,
  menu_engineering: exportMenuEngineeringPDF,
};

export function exportVisualPdfByMode(payload) {
  const mode = payload.exportMeta?.targetMode || "manager_review";
  const fn = MODE_EXPORTERS[mode] || exportManagerReviewPDF;
  fn(payload);
}
