import { waiterSalesValue } from "../utils/waiterSalesMetric";
import {
  COLOR_BENCHMARK,
  COLOR_PERFORMANCE,
  COLOR_RISK,
  COLOR_OPPORTUNITY,
  COLOR_NEUTRAL,
} from "../config/executiveVisualLanguage";
import {
  EXPORT_PRIMARY,
  EXPORT_SECONDARY,
  EXPORT_MUTED,
  TABLE_HEAD_BG,
  TABLE_ROW_A,
  TABLE_ROW_B,
  CONTENT_PANEL_BG,
  convPctAccent,
} from "../utils/exportExecutiveVisual";

export const NAC_TEAL = COLOR_PERFORMANCE;
export const NAC_GOLD = COLOR_BENCHMARK;
export const NAC_WHITE = EXPORT_PRIMARY;
export const PAGE_BG = [10, 11, 12];
export const CARD_BG = [18, 20, 24];
export { COLOR_RISK, COLOR_OPPORTUNITY, COLOR_NEUTRAL };
export {
  EXPORT_PRIMARY,
  EXPORT_SECONDARY,
  EXPORT_MUTED,
  EXPORT_TEAL,
  EXPORT_GOLD,
  EXPORT_RISK,
  convPctAccent,
  parsePctValue,
  formatMomentumDelta,
} from "../utils/exportExecutiveVisual";

export function setExportFont(doc, weight = "normal", size) {
  if (size) doc.setFontSize(size);
  const bold = weight === "bold" || weight === 600 || weight === 700;
  doc.setFont("helvetica", bold ? "bold" : "normal");
}

const TIER_COLORS = {
  primary: EXPORT_PRIMARY,
  secondary: EXPORT_SECONDARY,
  muted: EXPORT_MUTED,
  gold: NAC_GOLD,
  teal: NAC_TEAL,
  risk: COLOR_RISK,
};

/** Simulated text-shadow for PDF readability on dark backgrounds */
export function paintExportText(doc, text, x, y, options = {}) {
  const { tier = "primary", shadow = true, align, maxWidth } = options;
  const lines = maxWidth ? doc.splitTextToSize(String(text), maxWidth) : [String(text)];
  lines.forEach((line, i) => {
    const ly = y + i * (options.lineHeight || 11);
    if (shadow) {
      doc.setTextColor(0, 0, 0);
      doc.text(line, x + 1, ly + 2, { align });
      doc.text(line, x + 0.5, ly + 1.5, { align });
    }
    doc.setTextColor(...(TIER_COLORS[tier] || EXPORT_PRIMARY));
    doc.text(line, x, ly, { align });
  });
  return y + lines.length * (options.lineHeight || 11);
}

export function fillPage(doc) {
  doc.setFillColor(...PAGE_BG);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
}

/** Matte panel behind dense data — reduces competing gold glow */
export function drawContentPanel(doc, x, y, w, h) {
  doc.setFillColor(...CONTENT_PANEL_BG);
  doc.setDrawColor(48, 52, 58);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 6, 6, "FD");
}

export function drawMicroSparkline(doc, x, y, w, h, values, color = NAC_TEAL) {
  const pts = (values || []).filter((v) => Number.isFinite(v));
  if (pts.length < 2) return;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.9);
  let prevX;
  let prevY;
  pts.forEach((v, i) => {
    const px = x + (i / (pts.length - 1)) * w;
    const py = y + h - ((v - min) / span) * h;
    if (i > 0) doc.line(prevX, prevY, px, py);
    prevX = px;
    prevY = py;
  });
}

export function buildExportTableStyles(extra = {}) {
  return {
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 6, right: 5, bottom: 6, left: 5 },
      minCellHeight: 16,
      lineHeight: 1.4,
      textColor: EXPORT_PRIMARY,
      lineColor: [50, 54, 62],
      lineWidth: 0.2,
      font: "helvetica",
      overflow: "linebreak",
      ...extra.styles,
    },
    headStyles: {
      fillColor: TABLE_HEAD_BG,
      textColor: EXPORT_PRIMARY,
      fontStyle: "bold",
      fontSize: 7.5,
      cellPadding: 6,
      lineColor: [62, 66, 76],
      lineWidth: 0.35,
      ...extra.headStyles,
    },
    alternateRowStyles: { fillColor: TABLE_ROW_B },
    ...extra,
  };
}

export function applyExportTableRowStriping(data, rowIndex) {
  if (data.section !== "body") return;
  data.cell.styles.fillColor = rowIndex % 2 === 0 ? TABLE_ROW_A : TABLE_ROW_B;
}

export function applyConvPctHighlight(data, pct, highlightCols = []) {
  if (data.section !== "body" || !highlightCols.includes(data.column.index)) return;
  const accent = convPctAccent(pct);
  data.cell.styles.textColor = accent;
  data.cell.styles.fontStyle = "bold";
}

export function sectionOn(sections, key) {
  return sections?.[key] !== false;
}

export function newPage(doc, margin) {
  doc.addPage();
  fillPage(doc);
  return margin + 20;
}

export function drawPageTitle(doc, margin, title, subtitle) {
  setExportFont(doc, 700, 16);
  paintExportText(doc, title, margin, 36, { tier: "gold", shadow: true });
  if (subtitle) {
    setExportFont(doc, 500, 9);
    const lines = doc.splitTextToSize(subtitle, 500);
    lines.slice(0, 2).forEach((ln, i) => {
      paintExportText(doc, ln, margin, 52 + i * 12, { tier: "secondary", shadow: true });
    });
  }
  return subtitle ? 76 : 56;
}

export function drawLegendRow(doc, margin, y, contentW, items = []) {
  const colW = contentW / Math.max(items.length, 1);
  items.forEach((item, i) => {
    const x = margin + i * colW;
    doc.setFillColor(...(item.color || COLOR_NEUTRAL));
    doc.circle(x + 4, y + 3, 2.5, "F");
    setExportFont(doc, 500, 7);
    paintExportText(doc, item.label, x + 12, y + 6, { tier: "muted", shadow: true });
  });
  return y + 14;
}

export function drawCallout(doc, margin, y, maxW, { accent = NAC_TEAL, title, body, hint }) {
  const h = hint ? 54 : 44;
  drawContentPanel(doc, margin, y, maxW, h);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, y, maxW, h, 4, 4, "S");
  setExportFont(doc, 600, 8);
  paintExportText(doc, title, margin + 10, y + 14, { tier: "gold", shadow: true });
  setExportFont(doc, 500, 7.5);
  doc.splitTextToSize(body || "", maxW - 20)
    .slice(0, 2)
    .forEach((ln, i) => {
      paintExportText(doc, ln, margin + 10, y + 28 + i * 10, { tier: "secondary", shadow: true });
    });
  if (hint) {
    setExportFont(doc, 500, 7);
    paintExportText(doc, hint, margin + 10, y + h - 8, { tier: "muted", shadow: true });
  }
  return y + h + 8;
}

export function drawKpiCard(doc, x, y, w, h, label, value, accent = NAC_TEAL) {
  drawContentPanel(doc, x, y, w, h);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.55);
  doc.roundedRect(x, y, w, h, 6, 6, "S");
  setExportFont(doc, 600, 8);
  paintExportText(doc, label, x + 10, y + 17, { tier: "muted", shadow: true, maxWidth: w - 16 });
  setExportFont(doc, "bold", 15);
  paintExportText(doc, String(value), x + 10, y + 36, { tier: "primary", shadow: true });
}

export function drawHBar(doc, x, y, w, h, pct, color) {
  doc.setFillColor(32, 34, 38);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setFillColor(...color);
  doc.roundedRect(x, y, Math.max(2, w * Math.min(1, pct / 100)), h, 2, 2, "F");
}

export function embedChart(doc, dataUrl, x, y, w, h) {
  if (!dataUrl) return y;
  try {
    drawContentPanel(doc, x, y, w, h);
    doc.addImage(dataUrl, "PNG", x + 2, y + 2, w - 4, h - 4);
    return y + h + 12;
  } catch {
    return y;
  }
}

export function drawInsightCard(doc, margin, y, ins, maxW = 500) {
  const sevColors = {
    high: COLOR_RISK,
    medium: [245, 166, 35],
    low: NAC_TEAL,
  };
  const col = sevColors[ins.severity] || sevColors.medium;
  drawContentPanel(doc, margin, y, maxW, 54);
  doc.setDrawColor(...col);
  doc.setLineWidth(0.45);
  doc.roundedRect(margin, y, maxW, 54, 4, 4, "S");
  setExportFont(doc, 600, 7);
  const conf = ins.confidenceLabel ? ` · ${ins.confidenceLabel}` : "";
  paintExportText(
    doc,
    `${(ins.severity || "medium").toUpperCase()} · ${ins.category || ins.type || "Insight"}${conf}`,
    margin + 8,
    y + 12,
    { tier: "gold", shadow: true },
  );
  setExportFont(doc, 600, 9);
  paintExportText(doc, ins.title || ins.headline || "", margin + 8, y + 24, { tier: "primary", shadow: true });
  setExportFont(doc, 500, 8);
  const body = ins.body || ins.action || ins.detail || "";
  doc.splitTextToSize(body, maxW - 16)
    .slice(0, 2)
    .forEach((ln, i) => {
      paintExportText(doc, ln, margin + 8, y + 38 + i * 10, { tier: "secondary", shadow: true });
    });
  return y + 60;
}

export function staffSalesLine(staff, salesMetric = "gross") {
  const sales = waiterSalesValue(staff, salesMetric);
  const label = salesMetric === "net" ? "Net sales" : "Gross sales";
  return `${label} ${sales.toLocaleString()} SAR · ${staff.quantity} units · Modifier attach ${staff.modifierAttachPct}% · Premium beverage ${staff.ops?.premiumBevPct ?? staff.beverageAttachPct ?? "—"}%`;
}

export function drawStaffCard(doc, margin, y, w, staff, rank, target, salesMetric = "gross") {
  const isTop = rank <= 2;
  const accent = isTop ? NAC_GOLD : staff.modifierAttachPct < 8 ? COLOR_RISK : NAC_TEAL;
  const h = target ? 96 : 80;
  drawContentPanel(doc, margin, y, w, h);
  doc.setDrawColor(...accent);
  doc.roundedRect(margin, y, w, h, 5, 5, "S");
  setExportFont(doc, 600, 8);
  paintExportText(doc, `${staff.roleLabel || "Waiter"} · #${rank}`, margin + 10, y + 14, {
    tier: "gold",
    shadow: true,
  });
  setExportFont(doc, "bold", 11);
  paintExportText(doc, staff.waiter, margin + 10, y + 28, { tier: "primary", shadow: true });
  setExportFont(doc, 500, 8);
  paintExportText(doc, staffSalesLine(staff, salesMetric), margin + 10, y + 42, {
    tier: "secondary",
    shadow: true,
    maxWidth: w - 20,
  });
  paintExportText(
    doc,
    `Strong: ${staff.strongestCategory || "—"} · Weak: ${staff.weakestCategory || "—"}`,
    margin + 10,
    y + 54,
    { tier: "muted", shadow: true, maxWidth: w - 20 },
  );
  if (target) {
    setExportFont(doc, 500, 7);
    const action = doc.splitTextToSize(target.action || "", w - 20).slice(0, 2);
    action.forEach((ln, i) => {
      paintExportText(doc, ln, margin + 10, y + 68 + i * 9, { tier: "gold", shadow: true });
    });
  }
  return y + h + 8;
}

export function drawCover(doc, margin, contentW, lines) {
  fillPage(doc);
  setExportFont(doc, "bold", 24);
  paintExportText(doc, lines.brand || "NAC Hospitality OS", margin, 56, { tier: "gold", shadow: true });
  setExportFont(doc, 600, 14);
  paintExportText(doc, lines.title, margin, 82, { tier: "primary", shadow: true });
  setExportFont(doc, 500, 10);
  paintExportText(doc, lines.subtitle || "", margin, 100, { tier: "secondary", shadow: true });
  if (lines.meta) {
    setExportFont(doc, 500, 9);
    paintExportText(doc, lines.meta, margin, 118, { tier: "muted", shadow: true });
  }
  if (lines.blurb) {
    setExportFont(doc, 500, 9);
    const blurb = doc.splitTextToSize(lines.blurb, contentW);
    blurb.slice(0, 4).forEach((ln, i) => {
      paintExportText(doc, ln, margin, 140 + i * 12, { tier: "secondary", shadow: true });
    });
  }
}

export function salesMetricFromPayload(payload) {
  return payload.waiters?.salesMetric || payload.exportMeta?.salesMetric || "gross";
}
