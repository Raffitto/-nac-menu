var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/intelligence/askNac/vault/vaultStructuredFactsReplace.js
var vaultStructuredFactsReplace_exports = {};
__export(vaultStructuredFactsReplace_exports, {
  replaceStructuredFactsForFile: () => replaceStructuredFactsForFile
});
module.exports = __toCommonJS(vaultStructuredFactsReplace_exports);
async function replaceStructuredFactsForFile(admin, {
  fileId,
  rows,
  periodStart,
  periodEnd,
  minInserted
}) {
  if (!fileId) throw new Error("Structured facts replace requires file_id.");
  if (!rows?.length) throw new Error("Structured facts replace requires at least one fact row.");
  const payload = rows.map((row) => ({
    file_version_id: row.file_version_id ?? null,
    branch_id: row.branch_id ?? null,
    brand_wide: row.brand_wide ?? false,
    department: row.department,
    report_type: row.report_type,
    sensitivity_level: row.sensitivity_level,
    metric_key: row.metric_key,
    metric_value: row.metric_value ?? null,
    metric_unit: row.metric_unit ?? null,
    dimensions: row.dimensions ?? {},
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
    grain: row.grain ?? "daily",
    source_row_ref: row.source_row_ref ?? null,
    confidence: row.confidence ?? null,
    created_by: row.created_by ?? null
  }));
  const { data, error } = await admin.rpc("replace_ask_nac_file_structured_facts", {
    p_file_id: fileId,
    p_facts: payload,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_min_inserted: minInserted ?? rows.length
  });
  if (error) throw new Error(error.message);
  return {
    inserted: Number(data?.inserted ?? 0),
    deleted: Number(data?.deleted ?? 0)
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  replaceStructuredFactsForFile
});
