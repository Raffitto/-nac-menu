import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { businessDayExportNote } from "../utils/businessDay";
import { exportCell } from "../utils/intelligenceSanity";

const NAC_TEAL = [48, 72, 78];
const NAC_GOLD = [143, 122, 95];
const NAC_WHITE = [249, 249, 247];
const PAGE_BG = [12, 12, 14];
const CARD_BG = [22, 24, 28];

function fillPage(doc) {
  doc.setFillColor(...PAGE_BG);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
}

function newPage(doc, margin) {
  doc.addPage();
  fillPage(doc);
  return margin;
}

function sectionOn(sections, key) {
  return sections?.[key] !== false;
}

function drawPageTitle(doc, margin, title, subtitle) {
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(16);
  doc.text(title, margin, 40);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(160, 160, 160);
    doc.text(subtitle, margin, 56);
  }
  return 68;
}

function drawKpiCard(doc, x, y, w, h, label, value, accent = NAC_TEAL) {
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 6, 6, "FD");
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(label, x + 10, y + 16);
  doc.setFontSize(14);
  doc.setTextColor(...NAC_WHITE);
  doc.text(String(value), x + 10, y + 34);
}

function drawHBar(doc, x, y, w, h, pct, color) {
  doc.setFillColor(40, 40, 44);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setFillColor(...color);
  doc.roundedRect(x, y, Math.max(2, w * Math.min(1, pct / 100)), h, 2, 2, "F");
}

function embedChart(doc, dataUrl, x, y, w, h) {
  if (!dataUrl) return y;
  try {
    doc.addImage(dataUrl, "PNG", x, y, w, h);
    return y + h + 12;
  } catch {
    return y;
  }
}

function drawInsightCard(doc, margin, y, ins, maxW = 500) {
  const sevColors = {
    high: [232, 93, 76],
    medium: [245, 166, 35],
    low: [78, 205, 196],
  };
  const col = sevColors[ins.severity] || sevColors.medium;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...col);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, maxW, 52, 4, 4, "FD");
  doc.setFontSize(7);
  doc.setTextColor(...col);
  doc.text(`${(ins.severity || "medium").toUpperCase()} · ${ins.category || ins.type || "Insight"}`, margin + 8, y + 12);
  doc.setFontSize(9);
  doc.setTextColor(...NAC_WHITE);
  doc.text(ins.title || ins.headline || "", margin + 8, y + 24);
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  const body = ins.body || ins.action || ins.detail || "";
  doc.splitTextToSize(body, maxW - 16).slice(0, 2).forEach((ln, i) => {
    doc.text(ln, margin + 8, y + 36 + i * 10);
  });
  return y + 58;
}

function drawStaffCard(doc, margin, y, w, staff, rank) {
  const isTop = rank <= 2;
  const accent = isTop ? NAC_GOLD : staff.modifierAttachPct < 8 ? [232, 93, 76] : NAC_TEAL;
  const h = 72;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...accent);
  doc.roundedRect(margin, y, w, h, 5, 5, "FD");
  doc.setFontSize(8);
  doc.setTextColor(...accent);
  doc.text(`${staff.roleLabel || "Waiter"}${rank === 1 ? " · #1" : ""}`, margin + 10, y + 14);
  doc.setFontSize(11);
  doc.setTextColor(...NAC_WHITE);
  doc.text(staff.waiter, margin + 10, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text(
    `${staff.net_sales?.toLocaleString()} SAR · ${staff.quantity} units · Mod ${staff.modifierAttachPct}% · Dessert ${staff.dessertAttachPct}%`,
    margin + 10,
    y + 42,
  );
  doc.text(
    `Strong: ${staff.strongestCategory || "—"} · Weak: ${staff.weakestCategory || "—"}`,
    margin + 10,
    y + 54,
  );
  return y + h + 8;
}

/**
 * Premium 6-page executive PDF — boardroom ready.
 */
export function exportExecutiveVisualPDF(payload) {
  const {
    attachment,
    timeShift,
    heat,
    menuEngineering,
    waiters,
    waiterTargets,
    sortedProducts,
    insights,
    kpis,
    exportMeta,
    sections = {},
    chartImages = {},
    staffOverview,
  } = payload;

  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  fillPage(doc);

  const branch = exportMeta?.branch || "all";
  const period = exportMeta?.period || businessDayExportNote();

  // —— PAGE 1: Executive overview ——
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(22);
  doc.text("NAC Hospitality OS", margin, 48);
  doc.setFontSize(11);
  doc.setTextColor(...NAC_WHITE);
  doc.text("Visual Intelligence — Executive Report", margin, 68);
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text(`${branch.toUpperCase()} · ${period} · ${new Date().toLocaleString()}`, margin, 82);

  let y = 100;
  const kpiW = (contentW - 24) / 4;
  const kpis_row = [
    ["Net modifier revenue", `${Math.round(attachment?.totals?.modifierRevenue || 0).toLocaleString()} SAR`],
    ["Active waiters", String(staffOverview?.waiterCount ?? waiters?.waiterCount ?? waiters?.waiters?.length ?? 0)],
    ["Missed upsells", String(attachment?.missedUpsells?.length || 0)],
    ["Peak daypart", timeShift?.peakDaypart?.label || "—"],
  ];
  kpis_row.forEach(([label, val], i) => {
    drawKpiCard(doc, margin + i * (kpiW + 8), y, kpiW, 48, label, val, i % 2 ? NAC_GOLD : NAC_TEAL);
  });
  y += 58;

  if (sectionOn(sections, "executive")) {
    doc.setFontSize(10);
    doc.setTextColor(...NAC_TEAL);
    doc.text("AI Operational Summary", margin, y);
    y += 14;
    (insights || []).slice(0, 3).forEach((ins) => {
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
    y += 6;
    drawKpiCard(doc, margin, y, contentW / 2 - 4, 40, "Menu sessions", kpis.sessions, NAC_TEAL);
    drawKpiCard(doc, margin + contentW / 2 + 4, y, contentW / 2 - 4, 40, "Heat leaders", heat?.hotNow?.length || 0, NAC_GOLD);
    y += 48;
  }

  // —— PAGE 2: Staff ——
  if (sectionOn(sections, "waiter") && waiters?.waiters?.length) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Staff Performance", "Waiters only — managers excluded from competition");

    y = embedChart(doc, chartImages.waiterRevenue, margin, y, contentW, 140) || y;
    if (!chartImages.waiterRevenue) {
      waiters.waiters.slice(0, 6).forEach((w, i) => {
        drawHBar(doc, margin, y + 4, contentW - 80, 8, (w.net_sales / (waiters.waiters[0].net_sales || 1)) * 100, NAC_TEAL);
        doc.setFontSize(8);
        doc.setTextColor(...NAC_WHITE);
        doc.text(`${w.waiter} — ${w.net_sales.toLocaleString()} SAR`, margin, y + 12);
        y += 18;
      });
      y += 8;
    } else {
      y += 8;
    }

    const podium = waiters.waiters.slice(0, 3);
    podium.forEach((w, i) => {
      if (y > 680) y = newPage(doc, margin);
      y = drawStaffCard(doc, margin, y, contentW, w, i + 1);
    });

    if (sectionOn(sections, "waiterTargets") && waiterTargets?.length) {
      y += 6;
      doc.setTextColor(...NAC_GOLD);
      doc.setFontSize(10);
      doc.text("Weekly coaching targets", margin, y);
      y += 12;
      waiterTargets.slice(0, 4).forEach((t) => {
        if (y > 700) y = newPage(doc, margin);
        y = drawInsightCard(doc, margin, y, {
          severity: t.priority || t.severity,
          category: t.category,
          title: t.headline,
          body: `${t.action}\n${t.impact || ""}`,
        });
      });
    }
  }

  // —— PAGE 3: Upsell + attachment ——
  if (sectionOn(sections, "attachment") || sectionOn(sections, "missed")) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Upsell & Attachment Intelligence", "Modifier pairs and missed opportunities");

    y = embedChart(doc, chartImages.attachment, margin, y, contentW, 130) || y;
    y = embedChart(doc, chartImages.missedUpsell, margin, y, contentW, 120) || y;

    if (sectionOn(sections, "missed") && attachment?.missedUpsells?.length) {
      autoTable(doc, {
        startY: y,
        head: [["Opportunity", "Attach %", "Target %", "Est. gap SAR", "Severity"]],
        body: attachment.missedUpsells.slice(0, 8).map((m) => [
          m.label,
          `${m.attachmentRate}%`,
          `${m.expectedPct}%`,
          m.estimatedLostRevenue.toLocaleString(),
          m.opportunityScore >= 50 ? "HIGH" : "MED",
        ]),
        styles: { fontSize: 8, textColor: NAC_WHITE, fillColor: CARD_BG },
        headStyles: { fillColor: [120, 50, 40], textColor: NAC_WHITE },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 12;
    }

    (attachment?.pairs || [])
      .filter((p) => p.attachedOrders > 0)
      .slice(0, 5)
      .forEach((p) => {
        if (y > 720) return;
        doc.setFontSize(8);
        doc.setTextColor(...NAC_WHITE);
        doc.text(`${p.label}: ${p.attachmentRate}% (target ${p.expectedPct}%)`, margin, y);
        drawHBar(doc, margin, y + 4, contentW, 6, (p.attachmentRate / Math.max(p.expectedPct, 1)) * 100, NAC_TEAL);
        y += 20;
      });
  }

  // —— PAGE 4: Menu engineering ——
  if (sectionOn(sections, "menuEng")) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Menu Engineering", "BCG quadrant · product performance");

    y = embedChart(doc, chartImages.menuScatter, margin, y, contentW, 150) || y;

    const quadrants = { Star: [], Puzzle: [], Workhorse: [], Dog: [] };
    (menuEngineering || []).forEach((m) => {
      if (quadrants[m.quadrant]) quadrants[m.quadrant].push(m);
    });
    ["Star", "Puzzle", "Workhorse", "Dog"].forEach((q) => {
      if (!quadrants[q].length) return;
      if (y > 700) y = newPage(doc, margin);
      doc.setTextColor(...(q === "Star" ? NAC_TEAL : q === "Puzzle" ? [245, 166, 35] : NAC_GOLD));
      doc.setFontSize(9);
      doc.text(`${q}s`, margin, y);
      y += 10;
      quadrants[q].slice(0, 4).forEach((m) => {
        doc.setFontSize(8);
        doc.setTextColor(200, 200, 200);
        doc.text(`· ${m.item_name} — ${m.orders} orders, ${m.views} views`, margin + 8, y);
        y += 11;
      });
      y += 4;
    });

    if (sectionOn(sections, "product") && sortedProducts?.length) {
      autoTable(doc, {
        startY: y + 6,
        head: [["Product", "Heat", "Orders", "Views"]],
        body: sortedProducts.slice(0, 10).map((p) => [
          exportCell(p.item_name),
          String(p.heatIndex ?? "—"),
          String(p.orders ?? "—"),
          String(p.views ?? "—"),
        ]),
        styles: { fontSize: 8, textColor: NAC_WHITE, fillColor: CARD_BG },
        headStyles: { fillColor: NAC_TEAL },
        margin: { left: margin, right: margin },
      });
    }
  }

  // —— PAGE 5: Heat + daypart ——
  if (sectionOn(sections, "heat")) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "Heat Score & Daypart", "Traffic patterns and item momentum");

    y = embedChart(doc, chartImages.hourlySales, margin, y, contentW, 130) || y;
    y = embedChart(doc, chartImages.heatScore, margin, y, contentW, 120) || y;

    if (timeShift?.peakDaypart) {
      doc.setFontSize(9);
      doc.setTextColor(180, 180, 180);
      doc.text(`Peak daypart: ${timeShift.peakDaypart.label}`, margin, y);
      y += 14;
    }

    (heat?.hotNow || []).slice(0, 6).forEach((h) => {
      doc.setTextColor(...NAC_WHITE);
      doc.setFontSize(8);
      doc.text(`${h.item_name} — heat ${h.heatIndex}`, margin, y);
      drawHBar(doc, margin + 120, y - 6, contentW - 140, 6, h.heatPct || 50, NAC_GOLD);
      y += 16;
    });
  }

  // —— PAGE 6: AI insights ——
  if (sectionOn(sections, "ai")) {
    doc.addPage();
    fillPage(doc);
    y = drawPageTitle(doc, margin, "AI Operational Insights", "Prioritized actions for GM review");

    (insights || []).forEach((ins) => {
      if (y > 700) y = newPage(doc, margin);
      y = drawInsightCard(doc, margin, y, {
        severity: ins.confidence === "high" ? "high" : ins.confidence === "low" ? "low" : "medium",
        category: ins.type,
        title: ins.title,
        body: `${ins.body}\n\nRecommended action: Review during next service briefing.`,
      });
    });
  }

  doc.save(`nac-executive-intelligence-${branch}.pdf`);
}

/** Bridge from legacy export name */
export function exportVisualIntelligencePDF(payload) {
  exportExecutiveVisualPDF(payload);
}
