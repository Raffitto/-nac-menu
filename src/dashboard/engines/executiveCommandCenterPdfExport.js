/**
 * Executive Command Center summary PDF.
 */

import { jsPDF } from "jspdf";
import {
  fillPage,
  drawKpiCard,
  drawCallout,
  drawContentPanel,
  paintExportText,
  setExportFont,
  sanitizeExportText,
  NAC_GOLD,
  NAC_TEAL,
  EXPORT_RISK,
} from "./pdfVisualTheme";
import { formatExecutiveCommandExportLines } from "./executiveCommandCenterEngine";
import { drawPredictiveExportBlock } from "./detailedBranchReviewExport";

const BRAND = "NAC HOSPITALITY OS";

function clip(str, max) {
  const s = sanitizeExportText(str);
  if (!s) return "-";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}...`;
}

/**
 * @param {object} ctx
 * @param {object} ctx.commandPackage — buildExecutiveCommandCenterPackage output
 * @param {string} [ctx.rangeLabel]
 */
export function exportExecutiveCommandCenterPdf(ctx = {}) {
  const pkg = ctx.commandPackage;
  if (!pkg) {
    if (typeof window !== "undefined") {
      window.alert("No executive command data available for export.");
    }
    return;
  }

  const brief = pkg.dailyBrief || {};
  const rangeLabel = ctx.rangeLabel || "Current period";
  const generated = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 44;
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;

  fillPage(doc);
  doc.setFillColor(...NAC_GOLD);
  doc.rect(0, 0, pageW, 4, "F");

  setExportFont(doc, 600, 9);
  paintExportText(doc, BRAND, margin, 40, { tier: "gold", shadow: true });

  setExportFont(doc, "bold", 22);
  paintExportText(doc, "Executive Command Center", margin, 68, { tier: "primary", shadow: true });

  setExportFont(doc, 500, 9);
  paintExportText(doc, `Period: ${rangeLabel}`, margin, 88, { tier: "muted", shadow: true });
  paintExportText(doc, `Generated ${generated}`, margin, 100, { tier: "muted", shadow: true });

  const cardW = (contentW - 16) / 3;
  const cardY = 118;
  const cards = [
    {
      label: "Network score",
      value: pkg.networkScore != null ? String(pkg.networkScore) : "—",
      accent: NAC_GOLD,
    },
    {
      label: "Google redirects",
      value: String(pkg.pulse?.total_redirects ?? 0),
      accent: NAC_TEAL,
    },
    {
      label: "Momentum",
      value: pkg.momentum?.momentum || "Stable",
      accent: NAC_TEAL,
    },
  ];
  cards.forEach((c, i) => {
    drawKpiCard(doc, margin + i * (cardW + 8), cardY, cardW, 48, c.label, c.value, c.accent);
  });

  let y = cardY + 64;

  y = drawCallout(doc, margin, y, contentW, {
    accent: NAC_GOLD,
    title: "Daily executive brief",
    body: clip(
      [
        brief.strongest_branch && `Strongest: ${brief.strongest_branch}.`,
        brief.weakest_branch && `Weakest: ${brief.weakest_branch}.`,
        brief.recommended_focus,
      ]
        .filter(Boolean)
        .join(" "),
      220,
    ),
    hint: brief.momentum_summary ? clip(brief.momentum_summary, 100) : "",
  });

  y += 8;
  const intelLines = formatExecutiveCommandExportLines(pkg);
  if (intelLines.length) {
    y = drawPredictiveExportBlock(doc, margin, contentW, y, intelLines);
  }

  y += 12;
  setExportFont(doc, 600, 9);
  paintExportText(doc, "Risk alerts", margin, y, { tier: "gold", shadow: true });
  y += 14;

  const alerts = pkg.alerts || [];
  if (!alerts.length) {
    setExportFont(doc, 500, 8);
    paintExportText(doc, "No active alerts for this period.", margin, y, { tier: "secondary", shadow: true });
    y += 16;
  } else {
    alerts.slice(0, 8).forEach((a) => {
      const color = a.severity === "critical" || a.severity === "risk" ? EXPORT_RISK : null;
      setExportFont(doc, 500, 8);
      paintExportText(
        doc,
        clip(`[${a.severity}] ${a.text}`, 95),
        margin,
        y,
        { tier: "secondary", shadow: true, color },
      );
      y += 12;
    });
  }

  y += 8;
  setExportFont(doc, 600, 9);
  paintExportText(doc, "Branch rankings", margin, y, { tier: "teal", shadow: true });
  y += 14;

  const panelH = 16 + (pkg.rankings?.length || 0) * 14;
  drawContentPanel(doc, margin, y - 4, contentW, Math.min(panelH, 80));

  (pkg.rankings || []).forEach((r, i) => {
    setExportFont(doc, 500, 8);
    paintExportText(
      doc,
      clip(
        `#${i + 1} ${r.branch_name} — score ${r.operational_score ?? "—"} (${r.health?.label || r.tier_label || ""})`,
        90,
      ),
      margin + 8,
      y + 6 + i * 14,
      { tier: "secondary", shadow: true },
    );
  });

  doc.save(`nac-executive-command-center-${Date.now()}.pdf`);
}
