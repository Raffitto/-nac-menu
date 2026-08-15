/**
 * Quality gates for commerce exports. Fail closed — never silent zero-row success.
 */

export type IngestGateResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function gateCommerceExport(input: {
  headers: string[];
  requiredHeaders: string[];
  rowCount: number;
  missingIds: number;
  duplicateIds: number;
  unclassifiedRate: number | null;
  operatingDayExpected?: boolean;
}): IngestGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const have = new Set(input.headers.map((h) => h.toLowerCase().trim()));
  for (const col of input.requiredHeaders) {
    if (!have.has(col.toLowerCase())) errors.push(`missing_column:${col}`);
  }
  if (input.rowCount <= 0) {
    if (input.operatingDayExpected) errors.push("empty_operating_day");
    else errors.push("empty_download");
  }
  if (input.missingIds > 0) errors.push("missing_source_ids");
  if (input.duplicateIds > 0) errors.push("duplicate_source_ids");
  if (input.unclassifiedRate != null && input.unclassifiedRate >= 0.5) {
    errors.push("unclassified_product_rate");
  } else if (input.unclassifiedRate != null && input.unclassifiedRate >= 0.2) {
    warnings.push("elevated_unclassified_rate");
  }
  return { ok: errors.length === 0, errors, warnings };
}
