/**
 * Unified executive PDF — one branded report with five ranked sections.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fillPage,
  drawContentPanel,
  paintExportText,
  setExportFont,
  buildExportTableStyles,
  applyExportTableRowStriping,
  newPage,
  NAC_GOLD,
} from "./pdfVisualTheme";
import { sanitizeTableForPdf } from "../utils/exportExecutiveVisual";

const BRAND = "NAC HOSPITALITY OS";
const TOP3_FILL = [42, 38, 28];

function clip(str, max = 36) {
  const s = String(str || "").trim();
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function drawSectionNote(doc, margin, y, contentW, note) {
  if (!note) return y;
  drawContentPanel(doc, margin, y, contentW, 28);
  setExportFont(doc, 500, 8);
  doc.splitTextToSize(note, contentW - 16).slice(0, 2).forEach((ln, i) => {
    paintExportText(doc, ln, margin + 8, y + 12 + i * 10, { tier: "muted", shadow: true });
  });
  return y + 36;
}

function drawRankedTable(doc, { margin, contentW, startY, head, body }) {
  const table = sanitizeTableForPdf(head, body);
  autoTable(doc, {
    ...buildExportTableStyles({ styles: { fontSize: 8 } }),
    startY,
    head: table.head,
    body: table.body,
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    didParseCell: (data) => {
      if (data.section !== "body") return;
      applyExportTableRowStriping(data, data.row.index);
      if (data.row.index < 3) {
        data.cell.styles.fillColor = TOP3_FILL;
        if (data.column.index === 0) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = NAC_GOLD;
        }
      }
    },
  });
  return doc.lastAutoTable.finalY + 16;
}

function ensureSpace(doc, y, needed, margin) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 40) {
    return newPage(doc, margin);
  }
  return y;
}

function drawSection(doc, { margin, contentW, y, title, subtitle, head, body, note }) {
  y = ensureSpace(doc, y, 80, margin);
  setExportFont(doc, 600, 11);
  paintExportText(doc, title, margin, y, { tier: "gold", shadow: true });
  y += 14;
  if (subtitle) {
    setExportFont(doc, 500, 8);
    paintExportText(doc, subtitle, margin, y, { tier: "muted", shadow: true });
    y += 12;
  }
  if (note && !body.length) {
    return drawSectionNote(doc, margin, y, contentW, note);
  }
  if (note) {
    y = drawSectionNote(doc, margin, y, contentW, note);
  }
  y = drawRankedTable(doc, { margin, contentW, startY: y, head, body });
  return y;
}

/**
 * @param {object} pkg — buildExecutiveUnifiedExportPackage output
 */
export function exportExecutiveUnifiedPdf(pkg) {
  if (!pkg) {
    if (typeof window !== "undefined") window.alert("No export data available.");
    return;
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;

  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, pageW, 4, "F");

  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  });

  setExportFont(doc, 600, 9);
  paintExportText(doc, BRAND, margin, 40, { tier: "gold", shadow: true });
  setExportFont(doc, "bold", 20);
  paintExportText(doc, "Executive Report", margin, 68, { tier: "primary", shadow: true });
  setExportFont(doc, 500, 9);
  paintExportText(doc, `Period: ${pkg.meta.periodLabel}`, margin, 88, { tier: "muted", shadow: true });
  paintExportText(doc, `Branch: ${pkg.meta.branchLabel}`, margin, 100, { tier: "muted", shadow: true });
  paintExportText(doc, `Generated ${generated}`, margin, 112, { tier: "muted", shadow: true });
  paintExportText(doc, pkg.meta.dataSourceNote, margin, 124, { tier: "secondary", shadow: true });

  if (pkg.provisional) {
    setExportFont(doc, 500, 8);
    paintExportText(doc, "Import integrity warning — some figures are provisional.", margin, 140, {
      tier: "risk",
      shadow: true,
    });
  }

  let y = pkg.provisional ? 156 : 142;

  y = drawSection(doc, {
    margin,
    contentW,
    y,
    title: "1. Top 10 items by net quantity",
    subtitle: pkg.meta.productBatchLabel ? `Product import: ${pkg.meta.productBatchLabel}` : null,
    head: [["#", "Item", "Net Qty", "Net Sales"]],
    body: (pkg.topItems.rows || []).map((r) => [r.rank, clip(r.item_name), r.display_quantity, r.display_net_sales]),
    note: pkg.topItems.note,
  });

  y = drawSection(doc, {
    margin,
    contentW,
    y,
    title: "2. Least 10 items by net quantity",
    subtitle: "Menu items, sides, add-ons, and modifiers only (promo/noise excluded)",
    head: [["#", "Item", "Net Qty", "Net Sales"]],
    body: (pkg.bottomItems.rows || []).map((r) => [r.rank, clip(r.item_name), r.display_quantity, r.display_net_sales]),
    note: pkg.bottomItems.note,
  });

  y = drawSection(doc, {
    margin,
    contentW,
    y,
    title: "3. Waiter net sales ranking",
    subtitle: pkg.meta.waiterBatchLabel ? `Waiter import: ${pkg.meta.waiterBatchLabel}` : null,
    head: [["#", "Waiter", "Net Sales", "Units", "Role"]],
    body: (pkg.waiterSales.rows || []).map((r) => [
      r.rank,
      clip(r.waiter, 24),
      r.display_net_sales,
      r.display_quantity,
      clip(r.role, 12),
    ]),
    note: pkg.waiterSales.note,
  });

  const upsellLabel =
    pkg.upsellFocusItems?.length > 0 ? pkg.upsellFocusItems.join(", ") : null;
  y = drawSection(doc, {
    margin,
    contentW,
    y,
    title: "4. Waiter upsell ranking",
    subtitle: upsellLabel ? `Tracking: ${clip(upsellLabel, 80)}` : null,
    head: [["#", "Waiter", "Upsell Qty", "Upsell Net", "Role"]],
    body: (pkg.waiterUpsell.rows || []).map((r) => [
      r.rank,
      clip(r.waiter, 24),
      r.display_quantity,
      r.display_net_sales,
      clip(r.role, 12),
    ]),
    note: pkg.waiterUpsell.note,
  });

  drawSection(doc, {
    margin,
    contentW,
    y,
    title: "5. Khobar Google scan ranking",
    subtitle: "Ranked by Google redirects · all Khobar waiters shown",
    head: [["#", "Waiter", "Google", "QR Scans", "To Google %"]],
    body: (pkg.khobarGoogle.rows || []).map((r) => [
      r.rank,
      clip(r.waiter, 24),
      r.google_redirects,
      r.qr_scans,
      `${r.conversion_pct ?? 0}%`,
    ]),
    note: pkg.khobarGoogle.note,
  });

  const safeBranch = (pkg.meta.branchId || "report").replace(/\s+/g, "-").toLowerCase();
  doc.save(`nac-executive-report-${safeBranch}.pdf`);
}
