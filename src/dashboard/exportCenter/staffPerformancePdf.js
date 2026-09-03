import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function money(n) {
  if (n == null || n === "") return "—";
  return `${Number(n).toLocaleString("en-US")} SAR`;
}

export function buildStaffPerformancePdfBytes(report) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const title = `NAC ${report.branch} Staff Performance`;
  doc.setFontSize(16);
  doc.text(title, 40, 40);
  doc.setFontSize(11);
  doc.text(`${report.from} → ${report.to}`, 40, 58);

  autoTable(doc, {
    startY: 76,
    head: [["Rank", "Staff", "Avg Check", "Orders", "Guests", "Net Sales"]],
    body: (report.averageCheck || []).map((r) => [
      r.rank,
      r.staff,
      r.avgCheck ? `${r.avgCheck}` : "—",
      r.orders || "—",
      r.guests || "—",
      money(r.netSales),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 30, 30] },
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 76) + 18,
    head: [["Rank", "Staff", "Reviews"]],
    body: (report.reviews || []).map((r) => [r.rank, r.staff, r.reviews]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 30, 30] },
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 76) + 18,
    head: [["Rank", "Staff", "Qty", "Sales", "Share"]],
    body: (report.topUpsellers || []).slice(0, 12).map((r) => [
      r.rank,
      r.staff,
      r.qty,
      money(r.sales),
      `${r.share}%`,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 30, 30] },
  });

  autoTable(doc, {
    startY: (doc.lastAutoTable?.finalY || 76) + 18,
    head: [["Item", "Top", "2nd", "3rd", "Total"]],
    body: (report.whoSoldWhat || []).slice(0, 40).map((r) => [
      r.item,
      r.first ? `${r.first.staff} ${r.first.qty}` : "—",
      r.second ? `${r.second.staff} ${r.second.qty}` : "—",
      r.third ? `${r.third.staff} ${r.third.qty}` : "—",
      r.total,
    ]),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [30, 30, 30] },
  });

  const staff = report.staffNames || [];
  if (staff.length) {
    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 76) + 18,
      head: [["Item", ...staff, "Total"]],
      body: (report.matrix || []).map((r) => [r.item, ...staff.map((s) => r[s] || 0), r.total]),
      styles: { fontSize: 6 },
      headStyles: { fillColor: [30, 30, 30] },
    });
  }

  return doc.output("arraybuffer");
}
