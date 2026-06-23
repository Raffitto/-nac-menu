/**
 * Weekly management dashboard parser for Drive ingestion (Executive Reports / Weekly Dashboards).
 */

export type WeeklyDashboardFact = {
  metric_key: string;
  metric_value: number | null;
  dimensions: Record<string, unknown>;
  period_start: string | null;
  period_end: string | null;
  grain: string;
  source_row_ref: string;
  confidence: number;
};

export type WeeklyDashboardParseResult = {
  ok: boolean;
  error: string | null;
  facts: WeeklyDashboardFact[];
  periodStart: string | null;
  periodEnd: string | null;
  parser: "weekly_dashboard_workbook" | "weekly_dashboard_text";
};

const DASHBOARD_LABELS: Record<string, string[]> = {
  total_sales: ["total sales (sar)", "total sales"],
  guest_count: ["cash-up guests", "guest count", "guests"],
  seven_rooms_covers: ["7rooms covers (manual)", "7rooms covers", "7 rooms covers"],
  average_spend: ["average spend (sar)", "average spend"],
  delivery_sales: ["delivery sales (sar)", "delivery sales"],
  delivery_orders: ["delivery orders"],
  google_review_total: ["total reviews (logbook)", "total reviews"],
  google_average_stars: ["average stars"],
};

function parseNumberSafe(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[, SAR]/gi, "").replace(/[^\d.-]/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function normalizeLabel(raw: unknown) {
  return String(raw ?? "").trim().toLowerCase();
}

function matchMetricKey(label: string) {
  for (const [key, labels] of Object.entries(DASHBOARD_LABELS)) {
    if (labels.some((candidate) => label === candidate || label.startsWith(candidate))) return key;
  }
  return null;
}

function parsePeriodDates(text = "") {
  const isoRange = text.match(/\b(20\d{2}-\d{2}-\d{2})\s*[–-]\s*(20\d{2}-\d{2}-\d{2})\b/);
  if (isoRange) return { periodStart: isoRange[1], periodEnd: isoRange[2] };
  const weekEnding = text.match(/week ending\s+(20\d{2}-\d{2}-\d{2})/i);
  if (weekEnding) return { periodStart: weekEnding[1], periodEnd: weekEnding[1] };
  return { periodStart: null, periodEnd: null };
}

function extractSectionLines(matrix: unknown[][], sectionKey: string, stopPatterns: RegExp[]) {
  const lines: string[] = [];
  let mode = false;
  for (const row of matrix) {
    const cells = (row || []).map((cell) => String(cell ?? "").trim()).filter(Boolean);
    if (!cells.length) continue;
    const lower = normalizeLabel(cells[0]);
    if (lower === sectionKey || lower.startsWith(sectionKey)) {
      mode = true;
      continue;
    }
    if (mode && stopPatterns.some((pattern) => pattern.test(lower))) {
      mode = false;
      continue;
    }
    if (mode) {
      const text = cells.length === 1 ? cells[0] : cells.join(" ");
      if (text.length > 12) lines.push(text);
    }
  }
  return lines;
}

export function parseWeeklyDashboardMatrices(matrices: unknown[][][]): WeeklyDashboardParseResult {
  const matrix = matrices.flat();
  const facts: WeeklyDashboardFact[] = [];
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  for (const row of matrix) {
    const cells = (row || []).map((cell) => String(cell ?? "").trim());
    if (!cells.length) continue;
    const label = normalizeLabel(cells[0]);
    const valueCell = cells[1] ?? cells[0];

    if (label === "period") {
      const dates = parsePeriodDates(String(valueCell));
      periodStart = dates.periodStart;
      periodEnd = dates.periodEnd;
      continue;
    }

    const metricKey = matchMetricKey(label);
    if (metricKey) {
      facts.push({
        metric_key: metricKey,
        metric_value: parseNumberSafe(valueCell),
        dimensions: {},
        period_start: periodStart,
        period_end: periodEnd,
        grain: "weekly",
        source_row_ref: `dashboard-${metricKey}`,
        confidence: 0.82,
      });
    }
  }

  const executiveSummary = extractSectionLines(matrix, "executive summary", [
    /^sales performance$/i,
    /^guest performance$/i,
    /^operational commentary$/i,
  ]);
  const operationalCommentary = extractSectionLines(matrix, "operational commentary", [
    /^coverage/i,
    /^top products$/i,
    /^least products$/i,
  ]);

  executiveSummary.slice(0, 6).forEach((line, index) => {
    facts.push({
      metric_key: "executive_summary_line",
      metric_value: null,
      dimensions: { text_value: line, section: "executive_summary" },
      period_start: periodStart,
      period_end: periodEnd,
      grain: "line",
      source_row_ref: `executive-${index + 1}`,
      confidence: 0.75,
    });
  });

  operationalCommentary.slice(0, 8).forEach((line, index) => {
    facts.push({
      metric_key: "operational_commentary_line",
      metric_value: null,
      dimensions: { text_value: line, section: "operational_commentary" },
      period_start: periodStart,
      period_end: periodEnd,
      grain: "line",
      source_row_ref: `operational-${index + 1}`,
      confidence: 0.75,
    });
  });

  return {
    ok: facts.length > 0,
    error: facts.length ? null : "Weekly dashboard parser found no structured content.",
    facts,
    periodStart,
    periodEnd,
    parser: "weekly_dashboard_workbook",
  };
}

export function parseWeeklyDashboardFromText(text = ""): WeeklyDashboardParseResult {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const matrix = lines.map((line) => {
    if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
    if (line.includes("|")) return line.split("|").map((cell) => cell.trim());
    if (line.includes(",")) return line.split(",").map((cell) => cell.trim());
    return [line];
  });
  const parsed = parseWeeklyDashboardMatrices([matrix]);
  return { ...parsed, parser: "weekly_dashboard_text" };
}

export async function parseWeeklyDashboardFromXlsxBuffer(buffer: ArrayBuffer): Promise<WeeklyDashboardParseResult> {
  const XLSX = await import("npm:xlsx@0.18.5");
  const workbook = XLSX.read(buffer, { type: "array" });
  const dashboardSheet = workbook.SheetNames.find((name: string) => /^dashboard$/i.test(name)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[dashboardSheet];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  return parseWeeklyDashboardMatrices([matrix]);
}

export function validateWeeklyDashboardParse(result: WeeklyDashboardParseResult): boolean {
  return Boolean(result.ok && result.facts.length);
}

export function attachWeeklyDashboardFactContext(
  facts: WeeklyDashboardFact[],
  fileRow: Record<string, unknown>,
  versionRowId: string | null,
  email: string,
) {
  return facts.map((fact) => ({
    file_id: fileRow.id,
    file_version_id: versionRowId,
    branch_id: fileRow.primary_branch_id,
    brand_wide: fileRow.brand_wide,
    department: fileRow.department,
    report_type: fileRow.report_type,
    sensitivity_level: fileRow.sensitivity_level,
    metric_key: fact.metric_key,
    metric_value: fact.metric_value,
    dimensions: fact.dimensions,
    period_start: fact.period_start || fileRow.period_start,
    period_end: fact.period_end || fact.period_start || fileRow.period_end,
    grain: fact.grain,
    source_row_ref: fact.source_row_ref,
    confidence: fact.confidence,
    created_by: email,
  }));
}
