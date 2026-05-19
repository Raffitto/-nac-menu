import { fillPage, drawPageTitle, embedChart, drawKpiCard, NAC_GOLD } from "./pdfVisualTheme";

/** Boardroom-ready operational visual pages (Phase 11). */
export function drawWaiterComparisonPdfPage(doc, margin, contentW, chartImages = {}) {
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Operational waiter comparison", "Revenue quality vs volume · shift-aware");

  y = embedChart(doc, chartImages.rqScatter, margin, y, contentW, 128) || y;

  const halfW = contentW / 2 - 6;
  const rowY = y + 6;
  embedChart(doc, chartImages.waiterRadar, margin, rowY, halfW, 112);
  embedChart(doc, chartImages.waiterGrouped, margin + halfW + 12, rowY, halfW, 112);
  y = rowY + 124;

  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text("High gross + low RQ = volume without margin · bubble color = AM / PM / mixed shift", margin, y);
  return y + 16;
}

export function drawBeverageIntelligencePdfPage(doc, margin, contentW, chartImages = {}, opportunity = null) {
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Beverage quality intelligence", "Mix quality — not drink quantity");

  if (opportunity?.teamTotal > 0) {
    drawKpiCard(
      doc,
      margin,
      y,
      contentW,
      46,
      "Est. premium beverage opportunity",
      `${Math.round(opportunity.teamTotal).toLocaleString()} SAR`,
      NAC_GOLD,
    );
    y += 56;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const note = opportunity.methodology || "";
    doc.splitTextToSize(note, contentW).slice(0, 2).forEach((ln, i) => {
      doc.text(ln, margin, y + i * 10);
    });
    y += 22;
  }

  y = embedChart(doc, chartImages.bevMixStacked, margin, y, contentW, 120) || y;

  const halfW = contentW / 2 - 6;
  const rowY = y + 6;
  embedChart(doc, chartImages.premBevLeaderboard, margin, rowY, halfW, 108);
  embedChart(doc, chartImages.bevOpportunity, margin + halfW + 12, rowY, halfW, 108);

  return rowY + 120;
}

export function appendOperationalVisualPages(doc, margin, contentW, chartImages, opportunity) {
  drawWaiterComparisonPdfPage(doc, margin, contentW, chartImages);
  doc.addPage();
  drawBeverageIntelligencePdfPage(doc, margin, contentW, chartImages, opportunity);
}
