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

export function drawExecutiveSummaryPage(doc, margin, contentW, summary, period) {
  fillPage(doc);
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(22);
  doc.text("Executive Summary", margin, 48);
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text(period || "", margin, 64);
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text("Management read — understand the period in 30 seconds", margin, 78);

  let y = 92;
  const kpiW = (contentW - 20) / 3;
  const kpis = [
    ["Total revenue", `${Math.round(summary.totalRevenue || 0).toLocaleString()} SAR`],
    ["Guest units", String(summary.totalQty || "—")],
    ["Top performer", summary.topWaiter || "—"],
    ["Breakfast leader", summary.strongestBreakfast || "—"],
    ["PM / dessert lead", summary.strongestPM || "—"],
    ["Highest avg ticket", `${summary.highestAvgTicket || "—"} (${summary.highestAvgTicketValue || "—"} SAR)`],
    ["Best modifier %", `${summary.bestModifier || "—"} (${summary.bestModifierPct || "—"}%)`],
    ["Premium bev mix", `${summary.premiumBevPenetration || 0}%`],
    ["Low-value drinks", `${summary.lowValueBevShare || 0}% of bev`],
    ["Est. missed upsell", `${Math.round(summary.estimatedMissedRevenue || 0).toLocaleString()} SAR`],
    ["Biggest win", (summary.bestWin || "—").slice(0, 42)],
    ["Biggest concern", (summary.biggestConcern || "—").slice(0, 42)],
  ];

  kpis.forEach(([label, val], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (row > 0 && col === 0) y += 58;
    drawKpiCard(doc, margin + col * (kpiW + 10), y, kpiW, 50, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
    if (col === 2) y += 58;
  });

  return y + 20;
}

export function drawAwardsGrid(doc, margin, y, contentW, awards = []) {
  if (y > 620) y = newPage(doc, margin);
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(11);
  doc.text("Staff KPI awards", margin, y);
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
  const h = 88;
  if (y > 700) y = newPage(doc, margin);
  const accent =
    coaching.severity === "high" ? [232, 93, 76] : coaching.severity === "low" ? NAC_GOLD : NAC_TEAL;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...accent);
  doc.roundedRect(margin, y, w, h, 5, 5, "FD");
  doc.setFontSize(7);
  doc.setTextColor(...accent);
  doc.text(
    `#${rank} · ${coaching.category || "Coaching"} · Score ${coaching.operationalScore ?? "—"} · ${coaching.shiftLean || ""}`,
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
    });
  });
  return y + 8;
}
