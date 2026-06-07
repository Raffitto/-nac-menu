/**
 * Normalized intermediate format passed from file adapter → report parsers.
 * @typedef {object} VaultParseIntermediate
 * @property {string} fileType
 * @property {string} extension
 * @property {string|null} mimeType
 * @property {Array<Array<any>>} matrix
 * @property {string} text
 * @property {string[]} lines
 * @property {Array<{ id: string, label: string, lines: string[], matrix: Array<Array<any>> }>} sections
 * @property {string[]} adapterWarnings
 */

export function createIntermediate({
  fileType,
  extension,
  mimeType = null,
  matrix = [],
  text = "",
  sections = [],
  adapterWarnings = [],
}) {
  const safeMatrix = Array.isArray(matrix) ? matrix : [];
  const safeText = String(text || "");
  const lines = safeText
    ? safeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : safeMatrix.map((row) => (Array.isArray(row) ? row.map(String).join(" | ") : String(row))).filter(Boolean);

  return {
    fileType,
    extension,
    mimeType,
    matrix: safeMatrix,
    text: safeText || lines.join("\n"),
    lines,
    sections: sections.length
      ? sections
      : [{ id: "main", label: "Main", lines, matrix: safeMatrix }],
    adapterWarnings,
  };
}

export function mergeMatrixAndText(intermediate) {
  const fromText = textLinesToMatrix(intermediate.lines || []);
  const combined = [...(intermediate.matrix || [])];
  for (const row of fromText) {
    combined.push(row);
  }
  return combined;
}

export function textLinesToMatrix(lines) {
  const matrix = [];
  for (const line of lines || []) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;

    if (trimmed.includes("\t")) {
      matrix.push(trimmed.split("\t").map((c) => c.trim()));
      continue;
    }
    if (trimmed.includes("|")) {
      matrix.push(trimmed.split("|").map((c) => c.trim()));
      continue;
    }
    const colon = trimmed.match(/^([^:]{2,80}):\s*(.+)$/);
    if (colon) {
      matrix.push([colon[1].trim(), colon[2].trim()]);
      continue;
    }
    if (/\s{2,}/.test(trimmed)) {
      matrix.push(trimmed.split(/\s{2,}/).map((c) => c.trim()));
      continue;
    }
    matrix.push([trimmed]);
  }
  return matrix;
}

export function sampleFactsForPreview(facts, limit = 8) {
  return (facts || []).slice(0, limit).map((fact) => ({
    metric_key: fact.metric_key,
    metric_value: fact.metric_value,
    dimensions: fact.dimensions,
    period_start: fact.period_start,
    grain: fact.grain,
  }));
}
