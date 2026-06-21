/**
 * Render Ask NAC executive PDF to disk for visual contrast checks.
 * Usage: node tmp-vault-verify/render-asknac-executive-pdf.mjs [output.pdf]
 */
import fs from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const outFile = path.resolve(process.argv[2] || path.join(__dirname, "asknac-executive-preview.pdf"));

const samplePayload = {
  meta: {
    reportTitle: "Sales performance · 19 June 2026",
    generatedAtLabel: "20 Jun 2026, 20:15",
    provenance: { label: "Verified deterministic" },
    confidence: "high",
  },
  context: { filterSummary: "Khobar · Today" },
  question: "show latest cash up",
  executiveBrief: {
    executiveSummary:
      "Khobar cash-up for 2026-06-19 shows net sales of 22,522.609 SAR (gross 25,901 SAR). Electronic payments represented 97.8% of recorded card/cash settlement.",
    keyFindings: [
      "Dinner generated 17,178.259 SAR and contributed 66% of gross sales.",
      "Electronic payments 24,293 SAR and cash 546 SAR — electronic payments represented 97.8% of recorded card/cash settlement.",
    ],
    operationalRisks: ["Coverage marked partial — treat as uploaded-file snapshot, not final close."],
    recommendedActions: ["Track delivery platform commission impact on net margin."],
    dataSources: ["Cash up 2026.xlsx · 2026-06-19 · cash_up"],
  },
  keyMetrics: [
    { key: "total_sales", label: "Total sales", value: "25,901", unit: "SAR", source: "sales_performance" },
    { key: "net_sales", label: "Net sales", value: "22,522.609", unit: "SAR", source: "sales_performance" },
    { key: "guest_count", label: "Guest count", value: "308", unit: "", source: "sales_performance" },
    { key: "order_count", label: "Order count", value: "139", unit: "", source: "sales_performance" },
    { key: "cash_sales", label: "Cash sales", value: "546", unit: "SAR", source: "sales_performance" },
    { key: "card_sales", label: "Electronic payments", value: "24,293", unit: "SAR", source: "sales_performance" },
    { key: "delivery_sales", label: "Delivery sales", value: "759", unit: "SAR", source: "sales_performance" },
    { key: "discounts", label: "Discounts", value: "0", unit: "SAR", source: "sales_performance" },
  ],
  sources: [{ name: "Cash up 2026.xlsx", detail: "Khobar · 2026-06-19" }],
  warnings: [],
};

for (const entry of [
  "src/intelligence/askNac/export/askNacPdfExport.js",
  "src/intelligence/askNac/export/askNacExportPayload.js",
  "src/intelligence/askNac/export/executiveBriefExport.js",
  "src/dashboard/engines/pdfVisualTheme.js",
  "src/dashboard/utils/exportExecutiveVisual.js",
]) {
  const base = path.basename(entry, ".js");
  execSync(
    `npx esbuild ${entry} --bundle --platform=node --format=cjs --external:jspdf --external:jspdf-autotable --outfile=${path.join(__dirname, `${base}.render.bundle.cjs`)}`,
    {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
    },
  );
}

const { jsPDF } = require("jspdf");
const captured = { buf: null };
jsPDF.prototype.save = function saveCapture() {
  captured.buf = Buffer.from(this.output("arraybuffer"));
};

const { exportAskNacExecutiveReport } = require("./askNacPdfExport.render.bundle.cjs");
exportAskNacExecutiveReport(samplePayload);
fs.writeFileSync(outFile, captured.buf);
console.log(outFile);
