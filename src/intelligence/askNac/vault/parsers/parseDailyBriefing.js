/**
 * Daily Briefing parser — one sheet per date (reservations, MOD, focus, staffing).
 */
import {
  buildStructuredFact,
  explainConfidence,
  extractLabelValuePairs,
  getParserMatrix,
  parseNacDateFromText,
  resolveBranchFromMatrix,
} from "./vaultParseUtils";

const BRIEFING_LABELS = {
  breakfast_reservations: ["breakfast reservations", "breakfast reservation", "breakfast res"],
  lunch_reservations: ["lunch reservations", "lunch reservation", "lunch res"],
  dinner_reservations: ["dinner reservations", "dinner reservation", "dinner res"],
  mod_breakfast: ["mod breakfast", "breakfast mod", "mod (breakfast)"],
  mod_lunch: ["mod lunch", "lunch mod", "mod (lunch)"],
  mod_dinner: ["mod dinner", "dinner mod", "mod (dinner)"],
  item_86: ["item 86", "86 item", "item86"],
  hostess: ["hostess", "hostess name", "hostess names"],
};

const SECTION_KEYS = {
  focus_points: ["focus points", "focus point", "focus for today"],
  section_assignments: ["section assignments", "sections", "section assignment"],
  staffing_notes: ["staffing notes", "staffing", "staff notes"],
};

export function parseDailyBriefingReport(intermediate, context) {
  const sheets = intermediate?.sheets || [];
  const matrix = getParserMatrix(intermediate);
  const branchId = resolveBranchFromMatrix(matrix, context.branchId);
  const facts = [];
  let maxConfidence = 0;

  const sheetBlocks = sheets.length ? sheets : [{ name: "Sheet1", matrix }];
  for (const sheet of sheetBlocks) {
    const sheetMatrix = sheet.matrix || matrix;
    const sheetText = sheet.text || matrixToText(sheetMatrix);
    const businessDate =
      parseSheetDate(sheet.name) ||
      parseNacDateFromText(sheetText) ||
      context.periodStart ||
      null;

    const { values, confidence: labelConfidence } = extractLabelValuePairs(sheetMatrix, BRIEFING_LABELS, {
      minConfidenceKeys: 2,
      text: sheetText,
    });
    const sections = extractSectionText(sheetText);
    const base = {
      fileId: context.fileId,
      branchId,
      brandWide: context.brandWide,
      department: context.department || "operations",
      reportType: "daily_briefing",
      sensitivityLevel: context.sensitivityLevel || "management",
      periodStart: businessDate,
      periodEnd: businessDate,
      createdBy: context.createdBy,
      confidence: labelConfidence,
    };

    for (const [key, raw] of Object.entries(values)) {
      const numeric = parseNumberSafe(raw);
      if (numeric != null) {
        facts.push(buildStructuredFact({ ...base, metricKey: key, metricValue: numeric, grain: "daily" }));
      } else if (raw != null && String(raw).trim()) {
        facts.push(
          buildStructuredFact({
            ...base,
            metricKey: key,
            metricValue: null,
            dimensions: { text_value: String(raw).trim() },
            grain: "daily",
          }),
        );
      }
    }

    for (const [sectionKey, lines] of Object.entries(sections)) {
      lines.slice(0, 6).forEach((line, index) => {
        facts.push(
          buildStructuredFact({
            ...base,
            metricKey: `${sectionKey}_line`,
            metricValue: null,
            dimensions: { text_value: line, section: sectionKey },
            grain: "line",
            sourceRowRef: `${sheet.name || "sheet"}-${sectionKey}-${index + 1}`,
          }),
        );
      });
    }

    maxConfidence = Math.max(maxConfidence, labelConfidence);
  }

  const coreMatched = facts.filter((fact) =>
    ["breakfast_reservations", "lunch_reservations", "dinner_reservations", "mod_dinner"].includes(fact.metric_key),
  ).length;
  const rawConfidence = Math.min(1, maxConfidence * 0.5 + (coreMatched / 4) * 0.35 + (facts.length ? 0.15 : 0));
  const confidenceMeta = explainConfidence(rawConfidence, {
    coreMatched,
    coreRequired: 1,
    warnings: intermediate?.adapterWarnings || [],
  });

  return {
    ok: facts.length > 0,
    branchId,
    periodStart: facts.find((fact) => fact.period_start)?.period_start || null,
    periodEnd: facts.find((fact) => fact.period_end)?.period_end || null,
    confidence: rawConfidence,
    confidenceMeta,
    facts,
    sections: ["reservations", "mod", "focus_points", "item_86", "hostess", "staffing"],
    stats: { coreMatched, factCount: facts.length, sheetCount: sheetBlocks.length },
    warnings: facts.length === 0 ? ["No daily briefing content detected."] : [],
    error: facts.length === 0 ? "Daily briefing parser found no structured content." : null,
  };
}

function matrixToText(matrix = []) {
  return (matrix || [])
    .map((row) => (row || []).map((cell) => String(cell ?? "").trim()).filter(Boolean).join("\t"))
    .filter(Boolean)
    .join("\n");
}

function parseSheetDate(name = "") {
  const iso = String(name || "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const dmy = String(name || "").match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }
  return null;
}

function extractSectionText(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections = { focus_points: [], section_assignments: [], staffing_notes: [] };
  let mode = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (SECTION_KEYS.focus_points.some((label) => lower.startsWith(label))) {
      mode = "focus_points";
      continue;
    }
    if (SECTION_KEYS.section_assignments.some((label) => lower.startsWith(label))) {
      mode = "section_assignments";
      continue;
    }
    if (SECTION_KEYS.staffing_notes.some((label) => lower.startsWith(label))) {
      mode = "staffing_notes";
      continue;
    }
    if (/^(breakfast|lunch|dinner|mod|reservations|item 86|hostess)\b/i.test(lower)) {
      mode = null;
      continue;
    }
    if (mode && line.length > 4) sections[mode].push(line);
  }
  return sections;
}

function parseNumberSafe(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[,]/g, "").replace(/[^\d.-]/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Build multi-sheet intermediate from workbook matrices (for tests + adapter). */
export function buildDailyBriefingIntermediate(sheetEntries = []) {
  const sheets = (sheetEntries || []).map((entry, index) => {
    const name = Array.isArray(entry) ? entry[0] : entry?.name;
    const matrix = Array.isArray(entry) ? entry[1] : entry?.matrix;
    return {
      name: name || `Sheet${index + 1}`,
      matrix: matrix || [],
      text: matrixToText(matrix || []),
    };
  });
  return {
    sheets,
    matrix: sheets[0]?.matrix || [],
    text: sheets.map((sheet) => sheet.text).join("\n\n"),
    sections: sheets.map((sheet) => ({ label: sheet.name })),
  };
}

/** Representative June 2026 daily briefing fixture (one sheet per date). */
export function buildDailyBriefingJune2026Fixture() {
  return buildDailyBriefingIntermediate([
    [
      "2026-06-01",
      [
        ["Daily Briefing", "2026-06-01"],
        ["Branch", "Khobar"],
        [],
        ["Breakfast reservations", 42],
        ["Lunch reservations", 68],
        ["Dinner reservations", 95],
        ["MOD breakfast", "Sara"],
        ["MOD lunch", "Omar"],
        ["MOD dinner", "Lyn"],
        [],
        ["Focus points"],
        ["Push terrace pre-bookings before 7pm."],
        ["Watch item 86 on sliders after 9pm."],
        [],
        ["Item 86", "Chicken sliders"],
        ["Hostess", "Maha / Reem"],
        [],
        ["Section assignments"],
        ["Terrace → Ahmed", "Main dining → Khalid"],
        [],
        ["Staffing notes"],
        ["One server on sick leave; cover from bar team."],
      ],
    ],
    [
      "2026-06-02",
      [
        ["Daily Briefing", "2026-06-02"],
        ["Breakfast reservations", 38],
        ["Lunch reservations", 71],
        ["Dinner reservations", 102],
        ["MOD dinner", "Omar"],
        ["Focus points", "Corporate lunch at 1pm — prep set menu."],
        ["Item 86", "None"],
        ["Hostess names", "Reem"],
      ],
    ],
  ]);
}
