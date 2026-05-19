import { waiterSalesValue } from "../utils/waiterSalesMetric";

export const NAC_TEAL = [48, 72, 78];
export const NAC_GOLD = [143, 122, 95];
export const NAC_WHITE = [249, 249, 247];
export const PAGE_BG = [12, 12, 14];
export const CARD_BG = [22, 24, 28];

export function fillPage(doc) {
  doc.setFillColor(...PAGE_BG);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
}

export function newPage(doc, margin) {
  doc.addPage();
  fillPage(doc);
  return margin + 20;
}

export function sectionOn(sections, key) {
  return sections?.[key] !== false;
}

export function drawPageTitle(doc, margin, title, subtitle) {
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

export function drawKpiCard(doc, x, y, w, h, label, value, accent = NAC_TEAL) {
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

export function drawHBar(doc, x, y, w, h, pct, color) {
  doc.setFillColor(40, 40, 44);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setFillColor(...color);
  doc.roundedRect(x, y, Math.max(2, w * Math.min(1, pct / 100)), h, 2, 2, "F");
}

export function embedChart(doc, dataUrl, x, y, w, h) {
  if (!dataUrl) return y;
  try {
    doc.addImage(dataUrl, "PNG", x, y, w, h);
    return y + h + 12;
  } catch {
    return y;
  }
}

export function drawInsightCard(doc, margin, y, ins, maxW = 500) {
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

export function staffSalesLine(staff, salesMetric = "gross") {
  const sales = waiterSalesValue(staff, salesMetric);
  const label = salesMetric === "net" ? "Net" : "Gross";
  return `${label} ${sales.toLocaleString()} SAR · ${staff.quantity} units · Mod ${staff.modifierAttachPct}% · Food ${staff.foodMixPct ?? "—"}% · Bev ${staff.beverageMixPct ?? staff.beverageAttachPct}%`;
}

export function drawStaffCard(doc, margin, y, w, staff, rank, target, salesMetric = "gross") {
  const isTop = rank <= 2;
  const accent = isTop ? NAC_GOLD : staff.modifierAttachPct < 8 ? [232, 93, 76] : NAC_TEAL;
  const h = target ? 96 : 80;
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...accent);
  doc.roundedRect(margin, y, w, h, 5, 5, "FD");
  doc.setFontSize(8);
  doc.setTextColor(...accent);
  doc.text(`${staff.roleLabel || "Waiter"} · #${rank}`, margin + 10, y + 14);
  doc.setFontSize(11);
  doc.setTextColor(...NAC_WHITE);
  doc.text(staff.waiter, margin + 10, y + 28);
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text(staffSalesLine(staff, salesMetric), margin + 10, y + 42);
  doc.text(`Strong: ${staff.strongestCategory || "—"} · Weak: ${staff.weakestCategory || "—"}`, margin + 10, y + 54);
  if (target) {
    doc.setFontSize(7);
    doc.setTextColor(...NAC_GOLD);
    const action = doc.splitTextToSize(target.action || "", w - 20).slice(0, 2);
    action.forEach((ln, i) => doc.text(ln, margin + 10, y + 68 + i * 9));
  }
  return y + h + 8;
}

export function drawCover(doc, margin, contentW, lines) {
  fillPage(doc);
  doc.setTextColor(...NAC_GOLD);
  doc.setFontSize(24);
  doc.text(lines.brand || "NAC Hospitality OS", margin, 56);
  doc.setFontSize(14);
  doc.setTextColor(...NAC_WHITE);
  doc.text(lines.title, margin, 82);
  doc.setFontSize(10);
  doc.setTextColor(130, 130, 130);
  doc.text(lines.subtitle || "", margin, 100);
  if (lines.meta) {
    doc.setFontSize(9);
    doc.text(lines.meta, margin, 118);
  }
  if (lines.blurb) {
    doc.setFontSize(9);
    doc.setTextColor(160, 160, 160);
    const blurb = doc.splitTextToSize(lines.blurb, contentW);
    blurb.slice(0, 4).forEach((ln, i) => doc.text(ln, margin, 140 + i * 12));
  }
}

export function salesMetricFromPayload(payload) {
  return payload.waiters?.salesMetric || payload.exportMeta?.salesMetric || "gross";
}
