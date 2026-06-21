/**
 * Render before/after Metrics Appendix contrast samples.
 * Usage: node tmp-vault-verify/render-pdf-table-contrast-compare.mjs
 */
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const outDir = path.join(__dirname, "pdf-contrast-compare");
fs.mkdirSync(outDir, { recursive: true });

const sampleMetrics = [
  ["Total sales", "25,901 SAR", "sales_performance"],
  ["Net sales", "22,522.609 SAR", "sales_performance"],
  ["Guest count", "308", "sales_performance"],
  ["Order count", "139", "sales_performance"],
  ["Cash sales", "546 SAR", "sales_performance"],
  ["Electronic payments", "24,293 SAR", "sales_performance"],
  ["Delivery sales", "759 SAR", "sales_performance"],
];

for (const [entry, outName] of [["src/dashboard/engines/pdfVisualTheme.js", "pdfVisualTheme.render.bundle.cjs"]]) {
  execSync(
    `npx esbuild ${entry} --bundle --platform=node --format=cjs --external:jspdf --external:jspdf-autotable --outfile=${path.join(__dirname, outName)}`,
    { cwd: root, stdio: "pipe" },
  );
}

const { jsPDF } = require("jspdf");
const autoTable = require("jspdf-autotable").default || require("jspdf-autotable");
const theme = require("./pdfVisualTheme.render.bundle.cjs");

const { NAC_TEAL, fillPage, EXPORT_PRIMARY, TABLE_ROW_B, buildExportTableStyles } = theme;

function renderLegacyMetricsTable() {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  fillPage(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(245, 210, 120);
  doc.text("BEFORE — broken alternating rows", 44, 48);
  autoTable(doc, {
    startY: 64,
    head: [["Metric", "Value", "Source"]],
    body: sampleMetrics,
    styles: {
      fontSize: 7.5,
      textColor: EXPORT_PRIMARY,
      lineColor: [50, 54, 62],
    },
    headStyles: {
      fillColor: NAC_TEAL,
      textColor: [12, 14, 16],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: TABLE_ROW_B },
    margin: { left: 44, right: 44 },
  });
  return Buffer.from(doc.output("arraybuffer"));
}

function renderFixedMetricsTable() {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  fillPage(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(245, 210, 120);
  doc.text("AFTER — readable dark rows + contrast guard", 44, 48);
  autoTable(doc, {
    startY: 64,
    head: [["Metric", "Value", "Source"]],
    body: sampleMetrics,
    ...buildExportTableStyles({
      headStyles: {
        fillColor: NAC_TEAL,
        textColor: [12, 14, 16],
        fontStyle: "bold",
      },
    }),
    margin: { left: 44, right: 44 },
  });
  return Buffer.from(doc.output("arraybuffer"));
}

const beforePdf = path.join(outDir, "metrics-appendix-before.pdf");
const afterPdf = path.join(outDir, "metrics-appendix-after.pdf");
fs.writeFileSync(beforePdf, renderLegacyMetricsTable());
fs.writeFileSync(afterPdf, renderFixedMetricsTable());

const beforePng = path.join(outDir, "metrics-appendix-before.png");
const afterPng = path.join(outDir, "metrics-appendix-after.png");
execSync(`qlmanage -t -s 1600 -o '${outDir}' '${beforePdf}' '${afterPdf}'`, { stdio: "pipe" });
fs.renameSync(`${beforePdf}.png`, beforePng);
fs.renameSync(`${afterPdf}.png`, afterPng);

console.log(JSON.stringify({ beforePdf, afterPdf, beforePng, afterPng }, null, 2));
