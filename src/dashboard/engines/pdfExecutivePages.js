import {
  fillPage,
  newPage,
  drawKpiCard,
  drawInsightCard,
  NAC_TEAL,
  NAC_GOLD,
  NAC_WHITE,
  CARD_BG,
} from "./pdfVisualTheme";
import { EXECUTIVE_LABELS } from "../config/executiveVisualLanguage";

export function drawExecutiveSummaryPage(doc, margin, contentW, summary, period) {
  fillPage(doc);
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(22);
  doc.text("Executive Summary", margin, 44);
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text(period || "", margin, 60);
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text("Cold-read for leadership — commercial priorities in one page", margin, 74);

  if (summary.totalRecoverable > 0) {
    drawKpiCard(
      doc,
      margin,
      88,
      contentW,
      54,
      EXECUTIVE_LABELS.recoverableOpportunity,
      `${Math.round(summary.totalRecoverable).toLocaleString()} SAR`,
      NAC_GOLD,
    );
  }

  let y = summary.totalRecoverable > 0 ? 152 : 92;
  const kpiW = (contentW - 20) / 3;
  const kpis = [
    ["Total revenue", `${Math.round(summary.totalRevenue || 0).toLocaleString()} SAR`],
    ["Guest units", String(summary.totalQty || "—")],
    ["Top performer", summary.topWaiter || "—"],
    [EXECUTIVE_LABELS.revenueQuality + " leader", `${summary.revenueQualityLeader || "—"} (${summary.revenueQualityScore || "—"}/100)`],
    ["Team avg revenue quality", `${summary.avgRevenueQuality || 0}/100`],
    [EXECUTIVE_LABELS.premiumBeverageMix, `${summary.premiumBevPenetration || 0}%`],
    ["Low-value drink share", `${summary.lowValueBevShare || 0}% of beverages`],
    [EXECUTIVE_LABELS.attachmentLeakage, `${Math.round(summary.attachmentLeakage || 0).toLocaleString()} SAR`],
    [EXECUTIVE_LABELS.beverageOpportunity, `${Math.round(summary.beverageOpportunity || 0).toLocaleString()} SAR`],
    ["Highest average ticket", `${summary.highestAvgTicket || "—"} (${summary.highestAvgTicketValue || "—"} SAR)`],
    ["Best modifier attach", `${summary.bestModifier || "—"} (${summary.bestModifierPct || "—"}%)`],
    ["Primary concern", (summary.biggestConcern || "—").slice(0, 36)],
  ];

  kpis.forEach(([label, val], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (row > 0 && col === 0) y += 58;
    drawKpiCard(doc, margin + col * (kpiW + 10), y, kpiW, 50, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
    if (col === 2) y += 58;
  });

  if (summary.validateNote) {
    y += 12;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(summary.validateNote, margin, y);
  }

  return y + 20;
}

export function drawAwardsGrid(doc, margin, y, contentW, awards = []) {
  if (y > 620) y = newPage(doc, margin);
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(11);
  doc.text("Staff performance awards", margin, y);
  y += 16;

  const cardW = (contentW - 16) / 2;
  awards.slice(0, 10).forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * (cardW + 16);
    const cy = y + row * 44;
    if (cy > 720) return;
    doc.setFillColor(...CARD_BG);
    doc.setDrawColor(...NAC_TEAL);
    doc.roundedRect(x, cy, cardW, 36, 4, 4, "FD");
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(a.label, x + 8, cy + 12);
    doc.setFontSize(10);
    doc.setTextColor(...NAC_WHITE);
    const val =
      a.format === "sar"
        ? `${Math.round(a.value || 0).toLocaleString()} SAR`
        : a.format === "pct"
          ? `${a.value}%`
          : a.format === "score"
            ? `${a.value}/100`
            : String(a.value ?? "—");
    doc.text(`${a.winner} — ${val}`, x + 8, cy + 26);
  });
  return y + Math.ceil(Math.min(awards.length, 10) / 2) * 44 + 12;
}

export function drawCoachingCard(doc, margin, y, w, coaching, rank) {
  const h = 96;
  if (y > 700) y = newPage(doc, margin);
  const accent =
    coaching.severity === "high" ? [232, 93, 76] : coaching.severity === "low" ? NAC_GOLD : NAC_TEAL;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...accent);
  doc.roundedRect(margin, y, w, h, 5, 5, "FD");
  doc.setFontSize(7);
  doc.setTextColor(...accent);
  const conf = coaching.confidenceLabel || "";
  const rq =
    coaching.revenueQualityScore != null
      ? ` · ${EXECUTIVE_LABELS.revenueQuality} ${coaching.revenueQualityScore}/100`
      : "";
  doc.text(
    `#${rank} · ${coaching.category || "Coaching"} · ${EXECUTIVE_LABELS.operationalScore} ${coaching.operationalScore ?? "—"}${rq}${conf ? ` · ${conf}` : ""}`,
    margin + 10,
    y + 12,
  );
  doc.setFontSize(11);
  doc.setTextColor(...NAC_WHITE);
  doc.text(coaching.waiter, margin + 10, y + 26);
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 200);
  const narrative = coaching.narrative || coaching.body || "";
  doc.splitTextToSize(narrative, w - 20).slice(0, 2).forEach((ln, i) => doc.text(ln, margin + 10, y + 40 + i * 10));
  doc.setFontSize(7);
  doc.setTextColor(...NAC_GOLD);
  const opp = coaching.opportunity || coaching.action || "";
  doc.splitTextToSize(opp, w - 20).slice(0, 2).forEach((ln, i) => doc.text(ln, margin + 10, y + 62 + i * 9));
  return y + h + 10;
}

export function drawOpsSection(doc, margin, y, contentW, title, items, type = "risk") {
  if (!items?.length) return y;
  if (y > 640) y = newPage(doc, margin);
  doc.setTextColor(...(type === "risk" ? [232, 93, 76] : NAC_TEAL));
  doc.setFontSize(11);
  doc.text(title, margin, y);
  y += 14;
  items.slice(0, 4).forEach((ins) => {
    if (y > 700) y = newPage(doc, margin);
    y = drawInsightCard(doc, margin, y, {
      severity: ins.severity || (type === "risk" ? "high" : "low"),
      category: type === "risk" ? "Risk" : "Opportunity",
      title: ins.title,
      body: ins.body,
      confidenceLabel: ins.confidenceLabel,
    });
  });
  return y + 8;
}
