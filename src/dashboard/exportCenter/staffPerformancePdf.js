import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { NEW_MENU_TARGET_LABELS } from "./trackedUpsellCatalog";

const PAGE = { bg: [12, 12, 14], ink: [245, 245, 242], muted: [168, 168, 162], gold: [201, 162, 39] };
const RANK_FILL = {
  1: [92, 74, 28],
  2: [72, 72, 74],
  3: [86, 58, 36],
};

function money(n) {
  if (n == null || n === "") return "—";
  return `${Number(n).toLocaleString("en-US")} SAR`;
}

function qtyCell(n) {
  if (n == null || n === "" || n === 0) return "-";
  return Number(n).toLocaleString("en-US");
}

function monthLabel(from, to) {
  if (!from || !to) return "";
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const month = start.toLocaleString("en-US", { month: "long" }).toUpperCase();
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) return month;
  return `${from} → ${to}`;
}

function periodLine(from, to) {
  if (!from || !to) return "";
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}-${end.getDate()} ${start.toLocaleString("en-US", { month: "long" })} ${start.getFullYear()}`;
  }
  return `${from} → ${to}`;
}

function fillPage(doc) {
  doc.setFillColor(...PAGE.bg);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
}

function heading(doc, text, y, x = 28) {
  doc.setTextColor(...PAGE.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(text, x, y);
}

function tableTheme(extra = {}) {
  return {
    theme: "plain",
    styles: {
      fontSize: 7.2,
      textColor: PAGE.ink,
      fillColor: [22, 22, 24],
      lineColor: [48, 48, 50],
      lineWidth: 0.2,
      cellPadding: 2.4,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [36, 36, 38],
      textColor: PAGE.ink,
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [18, 18, 20] },
    didParseCell: (data) => {
      const rank = Number(data.row.raw?.[0]);
      if (data.section === "body" && RANK_FILL[rank]) {
        data.cell.styles.fillColor = RANK_FILL[rank];
      }
    },
    ...extra,
  };
}

function paintPage1(doc, report) {
  fillPage(doc);
  const branch = String(report.branch || "khobar").toUpperCase();
  const month = monthLabel(report.from, report.to);
  doc.setTextColor(...PAGE.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`NAC ${branch} - ${month} STAFF PERFORMANCE`, 28, 34);

  const notes = (report.eligibilityNotes || []).join(" | ");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PAGE.muted);
  doc.text(`Period: ${periodLine(report.from, report.to)}${notes ? ` | ${notes}` : ""}`, 28, 48);

  heading(doc, "AVERAGE CHECK PERFORMANCE", 66);
  autoTable(doc, {
    startY: 72,
    margin: { left: 28, right: 248 },
    tableWidth: 310,
    head: [["Rank", "Staff", "Avg Check", "Orders", "Guests", "Net Sales w/ Tax"]],
    body: (report.averageCheck || []).map((r) => [
      r.rank,
      r.staff,
      r.avgCheck ? `${Number(r.avgCheck).toFixed(2)} SAR` : "—",
      Number(r.orders || 0).toLocaleString("en-US"),
      Number(r.guests || 0).toLocaleString("en-US"),
      money(r.netSales),
    ]),
    ...tableTheme(),
  });
  const leftBottom = doc.lastAutoTable.finalY;

  heading(doc, `GOOGLE REVIEWS - ${month} (${report.reviewTotal || 0})`, 66, 352);
  autoTable(doc, {
    startY: 72,
    margin: { left: 352 },
    tableWidth: 214,
    head: [["Rank", "Staff", "Reviews"]],
    body: (report.reviews || []).map((r) => [r.rank, r.staff, r.reviews]),
    ...tableTheme(),
  });
  const rightBottom = doc.lastAutoTable.finalY;

  const nextY = Math.max(leftBottom, rightBottom) + 18;
  heading(doc, `TOP 3 UPSELLERS - ${month}`, nextY);
  autoTable(doc, {
    startY: nextY + 6,
    margin: { left: 28, right: 28 },
    tableWidth: 360,
    head: [["Rank", "Staff", "Target Upsell Qty", "Upsell Sales", "Share"]],
    body: (report.topUpsellers || []).slice(0, 3).map((r) => [
      r.rank,
      r.staff,
      r.qty,
      money(r.sales),
      `${r.share}%`,
    ]),
    ...tableTheme(),
  });

  doc.setFontSize(7.5);
  doc.setTextColor(...PAGE.muted);
  doc.text(`New-menu targets: ${NEW_MENU_TARGET_LABELS.join(", ")}.`, 28, 820);
}

function paintPage2(doc, report) {
  fillPage(doc);
  heading(doc, "UPSELL ITEMS - WHO SOLD WHAT", 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PAGE.muted);
  doc.text(
    `Full period ${periodLine(report.from, report.to)} | Top 3 eligible sellers for every tracked upsell item | Six new menu items included`,
    28,
    46,
  );
  autoTable(doc, {
    startY: 54,
    margin: { left: 18, right: 18 },
    tableWidth: 559,
    head: [["Upsell Item", "Top Seller", "Qty", "2nd", "Qty", "3rd", "Qty", "Total"]],
    body: (report.whoSoldWhat || []).map((r) => [
      r.item,
      r.first?.staff || "-",
      r.first ? r.first.qty : "-",
      r.second?.staff || "-",
      r.second ? r.second.qty : "-",
      r.third?.staff || "-",
      r.third ? r.third.qty : "-",
      r.total,
    ]),
    ...tableTheme({
      styles: { fontSize: 6.4, textColor: PAGE.ink, fillColor: [22, 22, 24], cellPadding: 1.8 },
      didParseCell: undefined,
    }),
  });
}

function paintPage3(doc, report) {
  fillPage(doc);
  heading(doc, "UPSELL MATRIX", 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PAGE.muted);
  const notes = (report.eligibilityNotes || []).filter((n) => /Sujan|sales ranking/i.test(n)).join(" | ");
  doc.text(
    `Net quantity sold by eligible active staff for every tracked upsell item${notes ? ` | ${notes}` : ""}`,
    28,
    46,
  );
  const staff = report.staffNames || [];
  autoTable(doc, {
    startY: 54,
    margin: { left: 16, right: 16 },
    tableWidth: 563,
    head: [["Item", ...staff, "Total"]],
    body: (report.matrix || []).map((r) => [r.item, ...staff.map((s) => qtyCell(r[s])), r.total]),
    ...tableTheme({
      styles: { fontSize: 6.4, textColor: PAGE.ink, fillColor: [22, 22, 24], cellPadding: 2, halign: "center" },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 0) data.cell.styles.halign = "left";
      },
    }),
  });
}

export function buildStaffPerformancePdf(report) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  paintPage1(doc, report);
  doc.addPage();
  paintPage2(doc, report);
  doc.addPage();
  paintPage3(doc, report);
  return doc;
}

export function buildStaffPerformancePdfBytes(report) {
  return buildStaffPerformancePdf(report).output("arraybuffer");
}

export function staffPerformancePdfPageCount(report) {
  return buildStaffPerformancePdf(report).getNumberOfPages();
}
