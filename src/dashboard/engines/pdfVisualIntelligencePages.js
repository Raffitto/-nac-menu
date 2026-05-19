import {
  fillPage,
  drawPageTitle,
  embedChart,
  drawKpiCard,
  drawLegendRow,
  drawCallout,
  NAC_GOLD,
  NAC_TEAL,
  COLOR_RISK,
  COLOR_OPPORTUNITY,
} from "./pdfVisualTheme";
import { EXECUTIVE_LABELS } from "../config/executiveVisualLanguage";

export function drawWaiterComparisonPdfPage(doc, margin, contentW, chartImages = {}, bundleMeta = {}) {
  fillPage(doc);
  let y = drawPageTitle(
    doc,
    margin,
    "Operational waiter comparison",
    "Revenue quality vs gross sales · shift profile · monetization archetypes",
  );

  drawLegendRow(doc, margin, y, contentW, [
    { color: NAC_GOLD, label: "Morning shift" },
    { color: NAC_TEAL, label: "Dinner shift" },
    { color: [143, 122, 95], label: "Mixed daypart" },
    { color: NAC_GOLD, label: "Benchmark zone" },
  ]);
  y += 22;

  if (bundleMeta.volumeRisk) {
    y = drawCallout(doc, margin, y, contentW, {
      accent: COLOR_RISK,
      title: "Volume without margin",
      body: `${bundleMeta.volumeRisk.waiter}: ${bundleMeta.volumeRisk.scatterCallout || "Highest gross, weakest revenue quality"}`,
      hint: "Coach premium beverage and modifier attach — not more covers",
    });
  }
  if (bundleMeta.qualityLeader) {
    y = drawCallout(doc, margin, y, contentW, {
      accent: NAC_TEAL,
      title: "Revenue quality leader",
      body: `${bundleMeta.qualityLeader.waiter}: ${EXECUTIVE_LABELS.revenueQuality} ${bundleMeta.qualityLeader.rq}/100`,
      hint: "Use as floor benchmark for premium conversion",
    });
  }

  y = embedChart(doc, chartImages.rqScatter, margin, y, contentW, 155) || y;

  const halfW = (contentW - 12) / 2;
  const rowY = y + 4;
  embedChart(doc, chartImages.waiterRadar, margin, rowY, halfW, 130);
  embedChart(doc, chartImages.waiterGrouped, margin + halfW + 12, rowY, halfW, 130);

  return rowY + 142;
}

export function drawBeverageIntelligencePdfPage(doc, margin, contentW, chartImages = {}, opportunity = null) {
  fillPage(doc);
  let y = drawPageTitle(
    doc,
    margin,
    "Beverage quality intelligence",
    "Premium mix vs soft drinks — quality of drink revenue, not quantity",
  );

  if (opportunity?.teamTotal > 0) {
    drawKpiCard(
      doc,
      margin,
      y,
      contentW,
      50,
      EXECUTIVE_LABELS.beverageOpportunity,
      `${Math.round(opportunity.teamTotal).toLocaleString()} SAR`,
      COLOR_OPPORTUNITY,
    );
    y += 60;
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(opportunity.methodology || "", margin, y);
    y += 14;
  }

  y = embedChart(doc, chartImages.bevMixStacked, margin, y, contentW, 128) || y;

  const halfW = (contentW - 12) / 2;
  const rowY = y + 4;
  embedChart(doc, chartImages.premBevLeaderboard, margin, rowY, halfW, 118);
  embedChart(doc, chartImages.bevOpportunity, margin + halfW + 12, rowY, halfW, 118);

  return rowY + 128;
}

export function appendOperationalVisualPages(doc, margin, contentW, chartImages, opportunity, bundleMeta = {}) {
  drawWaiterComparisonPdfPage(doc, margin, contentW, chartImages, bundleMeta);
  doc.addPage();
  drawBeverageIntelligencePdfPage(doc, margin, contentW, chartImages, opportunity);
}
