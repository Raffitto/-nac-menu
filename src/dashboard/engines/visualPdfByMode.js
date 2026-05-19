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
  drawStaffCard,
  drawCover,
  salesMetricFromPayload,
  NAC_TEAL,
  NAC_GOLD,
  NAC_WHITE,
  CARD_BG,
} from "./pdfVisualTheme";

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

/** Weekly staff — waiter targets, focus items, coaching only */
function exportWeeklyStaffPDF(payload) {
  const {
    waiters,
    waiterTargets,
    attachment,
    insights,
    sections = {},
    chartImages = {},
    weeklyFocusItems = [],
  } = payload;
  const { doc, margin, contentW, branch, period, salesMetric, metricLabel } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Weekly Staff Target Report",
    subtitle: "Waiter performance · weekly focus · coaching actions",
    meta: `${branch.toUpperCase()} · ${period} · ${metricLabel}`,
    blurb:
      "Designed for floor briefings: per-waiter gross sales vs peers, modifier attachment, focus-item counts, and actionable coaching cards.",
  });

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(
    doc,
    margin,
    "Weekly focus items",
    weeklyFocusItems.length
      ? weeklyFocusItems.join(" · ")
      : "No focus items selected — add items in export config",
  );

  if (weeklyFocusItems.length && waiters?.waiters?.length) {
    autoTable(doc, {
      startY: y,
      head: [["Waiter", ...weeklyFocusItems.map((f) => (f.length > 14 ? `${f.slice(0, 12)}…` : f))]],
      body: waiters.waiters.map((w) => [
        w.waiter,
        ...weeklyFocusItems.map((label) => {
          const fp = (w.focusPerformance || []).find((f) => f.label === label);
          return String(fp?.qty ?? 0);
        }),
      ]),
      styles: { fontSize: 9, textColor: NAC_WHITE, fillColor: CARD_BG },
      headStyles: { fillColor: NAC_GOLD, textColor: NAC_WHITE },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  if (sectionOn(sections, "waiter") && waiters?.waiters?.length) {
    if (y > 640) {
      doc.addPage();
      fillPage(doc);
      y = margin + 20;
    }
    doc.setTextColor(...NAC_GOLD);
    doc.setFontSize(10);
    doc.text(`Staff ranking (${metricLabel})`, margin, y);
    y += 14;
    y = embedChart(doc, chartImages.waiterRevenue, margin, y, contentW, 140) || y;
    const maxSales = waiters.maxSales || waiterSalesValue(waiters.waiters[0], salesMetric) || 1;
    waiters.waiters.forEach((w) => {
      if (y > 700) y = newPage(doc, margin);
      const sales = waiterSalesValue(w, salesMetric);
      const pct = maxSales > 0 ? (sales / maxSales) * 100 : 0;
      drawHBar(doc, margin, y + 4, contentW - 80, 10, pct, NAC_TEAL);
      doc.setFontSize(9);
      doc.setTextColor(...NAC_WHITE);
      doc.text(`${w.waiter} — ${sales.toLocaleString()} SAR · ${w.quantity} u · Mod ${w.modifierAttachPct}%`, margin, y + 16);
      y += 26;
    });
  }

  const targetByWaiter = {};
  (waiterTargets || []).forEach((t) => {
    targetByWaiter[t.waiter] = t;
  });

  if (waiters?.waiters?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Per-waiter coaching cards", `${waiters.waiters.length} waiters`);
    waiters.waiters.forEach((w, i) => {
      if (y > 620) {
        doc.addPage();
        fillPage(doc);
        y = margin + 20;
      }
      y = drawStaffCard(doc, margin, y, contentW, w, i + 1, targetByWaiter[w.waiter], salesMetric);
    });
  }

  if (sectionOn(sections, "waiterTargets") && waiterTargets?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Weekly coaching targets", "Food mix · add-ons · upsell gaps");
    waiterTargets.forEach((t) => {
      if (y > 700) y = newPage(doc, margin);
      const body = [t.action, t.impact || "", t.secondaryNote || ""].filter(Boolean).join("\n");
      y = drawInsightCard(doc, margin, y, {
        severity: t.priority || t.severity,
        category: t.category,
        title: `${t.waiter}: ${t.headline}`,
        body,
      });
    });
  }

  if (sectionOn(sections, "modifier") && attachment?.pairs?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Modifier attachment (staff briefing)", "Top pairs to coach this week");
    attachment.pairs
      .filter((p) => p.attachedOrders > 0)
      .slice(0, 8)
      .forEach((p) => {
        if (y > 720) return;
        doc.setFontSize(9);
        doc.setTextColor(...NAC_WHITE);
        doc.text(`${p.label}: ${p.attachmentRate}% (target ${p.expectedPct}%)`, margin, y);
        drawHBar(doc, margin, y + 6, contentW, 8, (p.attachmentRate / Math.max(p.expectedPct, 1)) * 100, NAC_GOLD);
        y += 24;
      });
  }

  if (sectionOn(sections, "ai") && insights?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Floor manager notes", "AI highlights for this week");
    insights.slice(0, 5).forEach((ins) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: ins.confidence === "high" ? "high" : "medium",
        category: ins.type,
        title: ins.title,
        body: ins.body,
      });
    });
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
    insights,
    kpis,
    sections = {},
    chartImages = {},
    staffOverview,
  } = payload;
  const { doc, margin, contentW, branch, period, salesMetric, metricLabel } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Manager Review Report",
    subtitle: "Operational issues · staff · menu · missed upsells",
    meta: `${branch.toUpperCase()} · ${period}`,
    blurb: "Balanced ops view for GMs: attachment gaps, daypart peaks, staff outliers, and menu risks.",
  });

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Operations snapshot", metricLabel);

  const kpiW = (contentW - 16) / 3;
  [
    ["Missed upsells", String(attachment?.missedUpsells?.length || 0)],
    ["Modifier revenue", `${Math.round(attachment?.totals?.modifierRevenue || 0).toLocaleString()} SAR`],
    ["Peak daypart", timeShift?.peakDaypart?.label || "—"],
  ].forEach(([label, val], i) => {
    drawKpiCard(doc, margin + i * (kpiW + 8), y, kpiW, 48, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
  });
  y += 58;

  if (sectionOn(sections, "missed") && attachment?.missedUpsells?.length) {
    doc.setTextColor(...NAC_GOLD);
    doc.setFontSize(10);
    doc.text("Missed upsell opportunities", margin, y);
    y += 12;
    autoTable(doc, {
      startY: y,
      head: [["Opportunity", "Attach %", "Target %", "Est. gap SAR"]],
      body: attachment.missedUpsells.slice(0, 10).map((m) => [
        m.label,
        `${m.attachmentRate}%`,
        `${m.expectedPct}%`,
        m.estimatedLostRevenue.toLocaleString(),
      ]),
      styles: { fontSize: 8, textColor: NAC_WHITE, fillColor: CARD_BG },
      headStyles: { fillColor: [120, 50, 40] },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  y = embedChart(doc, chartImages.attachment, margin, y, contentW, 120) || y;
  y = embedChart(doc, chartImages.missedUpsell, margin, y, contentW, 110) || y;

  if (sectionOn(sections, "waiter") && waiters?.waiters?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(
      doc,
      margin,
      "Staff performance summary",
      `Managers ${staffOverview?.includeManagers ? "included" : "excluded"} · ${metricLabel}`,
    );
    const top = waiters.waiters.slice(0, 8);
    const maxSales = waiters.maxSales || waiterSalesValue(top[0], salesMetric) || 1;
    top.forEach((w) => {
      if (y > 700) y = newPage(doc, margin);
      const sales = waiterSalesValue(w, salesMetric);
      drawHBar(doc, margin, y, contentW, 8, maxSales > 0 ? (sales / maxSales) * 100 : 0, NAC_TEAL);
      doc.setFontSize(9);
      doc.setTextColor(...NAC_WHITE);
      doc.text(`${w.waiter} — ${sales.toLocaleString()} SAR · Mod ${w.modifierAttachPct}%`, margin, y + 14);
      y += 28;
    });
  }

  if (sectionOn(sections, "product") && sortedProducts?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Product & menu signals", "Visibility-linked performance");
    autoTable(doc, {
      startY: y,
      head: [["Product", "Heat", "Orders", "Views"]],
      body: sortedProducts.slice(0, 12).map((p) => [
        exportCell(p.item_name),
        String(p.heatIndex ?? "—"),
        String(p.orders ?? "—"),
        String(p.views ?? "—"),
      ]),
      styles: { fontSize: 8, textColor: NAC_WHITE, fillColor: CARD_BG },
      headStyles: { fillColor: NAC_TEAL },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  if (sectionOn(sections, "menuEng") && menuEngineering?.length) {
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
        doc.text(`· ${m.item_name} — ${m.orders} orders`, margin + 8, y);
        y += 11;
      });
      y += 4;
    });
  }

  if (sectionOn(sections, "ai") && insights?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "AI operational insights", "Prioritized for GM review");
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
    timeShift,
    heat,
    menuEngineering,
    waiters,
    insights,
    kpis,
    sections = {},
    chartImages = {},
  } = payload;
  const { doc, margin, contentW, branch, period, salesMetric, metricLabel } = baseCtx(payload);

  drawCover(doc, margin, contentW, {
    title: "Executive Boardroom Report",
    subtitle: "KPI summary · revenue · risks · opportunities",
    meta: `${branch.toUpperCase()} · ${period}`,
    blurb: "Board-ready snapshot: financial modifiers, session scale, heat momentum, and strategic AI signals — minimal floor detail.",
  });

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "Executive KPIs", period);

  const kpiW = (contentW - 24) / 4;
  const grandGross = waiters?.grandTotals?.gross_sales;
  const topWaiter = waiters?.topUpseller;
  const topSales = topWaiter ? waiterSalesValue(topWaiter, salesMetric) : 0;

  [
    ["Net modifier revenue", `${Math.round(attachment?.totals?.modifierRevenue || 0).toLocaleString()} SAR`],
    ["Staff gross (import)", grandGross != null ? `${Math.round(grandGross).toLocaleString()} SAR` : "—"],
    ["Missed upsells", String(attachment?.missedUpsells?.length || 0)],
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

  y = embedChart(doc, chartImages.hourlySales, margin, y, contentW, 130) || y;

  if (timeShift?.peakDaypart) {
    doc.setFontSize(10);
    doc.setTextColor(...NAC_WHITE);
    doc.text(`Peak daypart: ${timeShift.peakDaypart.label}`, margin, y);
    y += 18;
  }

  doc.addPage();
  fillPage(doc);
  y = drawPageTitle(doc, margin, "Risks & opportunities", "AI + menu engineering");

  const risks = (insights || []).filter((i) => i.type === "risk" || i.confidence === "high").slice(0, 4);
  const opps = (insights || []).filter((i) => i.type !== "risk").slice(0, 4);

  doc.setTextColor(...[232, 93, 76]);
  doc.setFontSize(10);
  doc.text("Risks", margin, y);
  y += 14;
  (risks.length ? risks : insights?.slice(0, 3) || []).forEach((ins) => {
    if (y > 700) y = newPage(doc, margin);
    y = drawInsightCard(doc, margin, y, { severity: "high", category: ins.type, title: ins.title, body: ins.body });
  });

  y += 8;
  doc.setTextColor(...NAC_TEAL);
  doc.setFontSize(10);
  doc.text("Opportunities", margin, y);
  y += 14;
  (opps.length ? opps : []).forEach((ins) => {
    if (y > 700) y = newPage(doc, margin);
    y = drawInsightCard(doc, margin, y, { severity: "low", category: ins.type, title: ins.title, body: ins.body });
  });

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
        body: `${m.attachmentRate}% attach vs ${m.expectedPct}% target · est. ${m.estimatedLostRevenue.toLocaleString()} SAR gap`,
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
    subtitle: "Product visibility · conversion · quadrant · heat score",
    meta: `${branch.toUpperCase()} · ${period}`,
    blurb: "Product-centric analysis: BCG quadrants, heat-index leaders, attachment pairs, and conversion-ranked items.",
  });

  doc.addPage();
  fillPage(doc);
  let y = drawPageTitle(doc, margin, "BCG quadrant analysis", "Stars · puzzles · workhorses · dogs");

  y = embedChart(doc, chartImages.menuScatter, margin, y, contentW, 160) || y;

  const quadrants = { Star: [], Puzzle: [], Workhorse: [], Dog: [] };
  (menuEngineering || []).forEach((m) => {
    if (quadrants[m.quadrant]) quadrants[m.quadrant].push(m);
  });

  ["Star", "Puzzle", "Workhorse", "Dog"].forEach((q) => {
    if (!quadrants[q].length) return;
    if (y > 680) y = newPage(doc, margin);
    doc.setTextColor(...(q === "Star" ? NAC_TEAL : q === "Puzzle" ? [245, 166, 35] : NAC_GOLD));
    doc.setFontSize(11);
    doc.text(`${q}s (${quadrants[q].length})`, margin, y);
    y += 14;
    quadrants[q].slice(0, 6).forEach((m) => {
      doc.setFontSize(9);
      doc.setTextColor(200, 200, 200);
      doc.text(`· ${m.item_name} — ${m.orders} orders, ${m.views} views`, margin + 8, y);
      y += 13;
    });
    y += 6;
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
    y = drawPageTitle(doc, margin, "Attachment & add-on intelligence", "Modifier pair performance");
    y = embedChart(doc, chartImages.attachment, margin, y, contentW, 120) || y;
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
    y = drawPageTitle(doc, margin, "Product & menu insights", "AI recommendations");
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
