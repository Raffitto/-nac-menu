import {
  fillPage,
  drawPageTitle,
  drawKpiCard,
  embedChart,
  drawCallout,
  drawLegendRow,
  drawInsightCard,
  NAC_GOLD,
  NAC_TEAL,
  COLOR_RISK,
  COLOR_OPPORTUNITY,
} from "./pdfVisualTheme";
import { EXECUTIVE_LABELS } from "../config/executiveVisualLanguage";

/** Dense financial opportunity page — executive cold-read */
export function drawFinancialOpportunityPage(doc, margin, contentW, financial = {}) {
  fillPage(doc);
  let y = drawPageTitle(
    doc,
    margin,
    "Recoverable commercial opportunity",
    "Aggregated monetization leakage — validate on next Foodics period",
  );

  const primary = financial.lines?.find((l) => l.primary) || financial.lines?.[financial.lines.length - 1];
  if (primary) {
    drawKpiCard(doc, margin, y, contentW, 56, primary.label, `${primary.value.toLocaleString()} SAR`, NAC_GOLD);
    y += 68;
  }

  const kpiW = (contentW - 16) / 2;
  (financial.lines || [])
    .filter((l) => !l.primary)
    .slice(0, 2)
    .forEach((line, i) => {
      drawKpiCard(
        doc,
        margin + i * (kpiW + 16),
        y,
        kpiW,
        48,
        line.label,
        `${line.value.toLocaleString()} SAR`,
        i ? COLOR_OPPORTUNITY : COLOR_RISK,
      );
    });
  y += 62;

  drawLegendRow(doc, margin, y, contentW, [
    { color: NAC_GOLD, label: "Benchmark / strategic target" },
    { color: NAC_TEAL, label: "Premium performance" },
    { color: COLOR_RISK, label: "Monetization leakage" },
    { color: COLOR_OPPORTUNITY, label: "Recoverable upside" },
  ]);
  y += 28;

  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text(
    "Executives should read this page as total addressable operational upside — not isolated attachment percentages.",
    margin,
    y,
  );
  y += 16;

  (financial.topLeaks || []).slice(0, 5).forEach((leak) => {
    y = drawInsightCard(doc, margin, y, {
      severity: leak.strategicallyPrioritized ? "high" : "medium",
      category: EXECUTIVE_LABELS.attachmentLeakage,
      title: leak.label,
      body: `${leak.attachRate}% attach vs ${leak.targetRate}% target · estimated ${Math.round(leak.amount).toLocaleString()} SAR monetization gap`,
    });
  });

  if (financial.validateNote) {
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(financial.validateNote, margin, y + 4);
  }

  return y + 20;
}

/** Denser staff performance with archetypes */
export function drawStaffPerformancePage(doc, margin, contentW, waiters = [], chartImages = {}, salesMetric = "gross") {
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Staff performance summary", "Ranking · revenue quality · shift profile");

  y = embedChart(doc, chartImages.waiterGrouped, margin, y, contentW, 145) || y;

  const list = [...(waiters || [])].sort((a, b) => (b.revenueQualityScore || 0) - (a.revenueQualityScore || 0));

  list.slice(0, 9).forEach((w, i) => {
    if (y > 700) {
      doc.addPage();
      fillPage(doc);
      y = margin + 24;
    }
    const arch = w.archetype?.label || "Operator";
    y = drawCallout(doc, margin, y, contentW, {
      accent: i === 0 ? NAC_GOLD : w.archetype?.tone === "critical" ? COLOR_RISK : NAC_TEAL,
      title: `#${i + 1} ${w.waiter} — ${arch}`,
      body: `${EXECUTIVE_LABELS.grossSales} ${Math.round(w.gross_sales || 0).toLocaleString()} SAR · ${EXECUTIVE_LABELS.avgTicket} ${Math.round(w.avgCheck || 0)} SAR · ${EXECUTIVE_LABELS.modifierAttach} ${w.modifierAttachPct}% · ${EXECUTIVE_LABELS.premiumBeverageMix} ${w.ops?.premiumBevPct ?? "—"}% · ${EXECUTIVE_LABELS.revenueQuality} ${w.revenueQualityScore}/100`,
      hint: w.scatterCallout || w.archetype?.hint || "",
    });
  });

  return y;
}
