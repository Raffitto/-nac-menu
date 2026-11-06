/**
 * Human-readable NAC codes. The database UUID stays the immutable identity.
 * Inventory family labels (F1, B1, …) stay on inventory_ingredients.human_code.
 * They are not NAC codes and are not replaced.
 * A Foodics SKU is an external attribute. It never allocates or matches a NAC code.
 */

export const NAC_ENTITY = Object.freeze({
  FINISHED_PRODUCT: "finished_product",
  INGREDIENT: "ingredient",
  PREPARATION: "preparation",
  INVENTORY_SUPPLY: "inventory_supply",
  RECIPE: "recipe",
});

export const NAC_PREFIX = Object.freeze({
  finished_product: "NAC-P",
  ingredient: "NAC-I",
  preparation: "NAC-PR",
  inventory_supply: "NAC-S",
  recipe: "NAC-R",
});

const CODE_PATTERN = /^(NAC-PR|NAC-P|NAC-I|NAC-S|NAC-R)-(\d+)$/;

export function parseNacCode(value) {
  const match = String(value || "").trim().toUpperCase().match(CODE_PATTERN);
  if (!match) return null;
  const prefix = match[1];
  const entityType = Object.keys(NAC_PREFIX).find((key) => NAC_PREFIX[key] === prefix);
  const number = Number(match[2]);
  if (!entityType || !Number.isInteger(number) || number < 1) return null;
  return {
    entityType,
    number,
    code: `${prefix}-${String(number).padStart(4, "0")}`,
  };
}

export function formatNacCode(entityType, number) {
  const prefix = NAC_PREFIX[entityType];
  if (!prefix) throw new Error(`Unknown NAC entity type: ${entityType}`);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error("NAC code numbers start at 1 and are never reused");
  }
  return `${prefix}-${String(number).padStart(4, "0")}`;
}

/** Next code for an entity type. Retired codes remain in `existing` and are not reused. */
export function nextNacCode(entityType, existing = []) {
  const prefix = NAC_PREFIX[entityType];
  let max = 0;
  for (const row of existing || []) {
    const parsed = parseNacCode(row?.nac_code || row?.nacCode || row);
    if (parsed && NAC_PREFIX[parsed.entityType] === prefix) max = Math.max(max, parsed.number);
  }
  return formatNacCode(entityType, max + 1);
}

export function foodicsRecordKey(record = {}) {
  const entityType = record.entityType || record.foodics_entity_type;
  const foodicsId = record.foodicsId || record.foodics_record_id;
  if (!entityType || !foodicsId) return null;
  return `${entityType}|${foodicsId}`;
}

/**
 * Same Foodics SKU on a product and an ingredient is valid.
 * Records merge only when entity type and Foodics record id both match.
 */
export function foodicsRecordsAreSame(left = {}, right = {}) {
  const leftKey = foodicsRecordKey(left);
  const rightKey = foodicsRecordKey(right);
  return Boolean(leftKey) && leftKey === rightKey;
}

export function classifyFoodicsSkuOverlap(records = []) {
  const findings = [];
  const bySku = new Map();
  for (const record of records || []) {
    const sku = String(record.sku || record.foodics_sku || "").trim().toLowerCase();
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku).push(record);
  }

  for (const [sku, rows] of bySku.entries()) {
    const types = [...new Set(rows.map((row) => row.entityType || row.foodics_entity_type).filter(Boolean))];
    if (types.length > 1) {
      findings.push({
        severity: "INFORMATIONAL",
        code: "foodics_sku_shared_across_types",
        sku,
        message: `Foodics SKU ${sku} is used by ${types.join(" and ")}. The records stay separate.`,
      });
    }
    const byType = new Map();
    for (const row of rows) {
      const type = row.entityType || row.foodics_entity_type || "unknown";
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(row);
    }
    for (const [entityType, group] of byType.entries()) {
      const ids = [...new Set(group.map((row) => row.foodicsId || row.foodics_record_id).filter(Boolean))];
      if (ids.length > 1) {
        findings.push({
          severity: "WARNING",
          code: "ambiguous_foodics_identity",
          sku,
          entityType,
          message: `Foodics SKU ${sku} matches ${ids.length} ${entityType} records. They were not merged.`,
        });
      }
    }
  }
  return findings;
}

export function scanNacCodes(identities = [], { activeTargets = null } = {}) {
  const findings = [];
  const seen = new Map();
  const linkedTargets = new Set();
  for (const row of identities || []) {
    const parsed = parseNacCode(row.nac_code || row.nacCode);
    if (!parsed) {
      findings.push({
        severity: "CRITICAL",
        code: "invalid_nac_code",
        message: `“${row.nac_code || row.nacCode || row.id}” is not a NAC code.`,
      });
      continue;
    }
    if (seen.has(parsed.code)) {
      findings.push({
        severity: "CRITICAL",
        code: "duplicate_nac_code",
        message: `${parsed.code} is assigned more than once.`,
      });
    }
    seen.set(parsed.code, row);
    if (row.target_id) linkedTargets.add(`${row.target_kind || "menu_item"}|${row.target_id}`);
    if (row.retired_at && row.target_id) {
      findings.push({
        severity: "CRITICAL",
        code: "retired_nac_code_in_use",
        message: `${parsed.code} is retired and still linked.`,
      });
    }
  }
  if (Array.isArray(activeTargets)) {
    for (const target of activeTargets) {
      const key = `${target.target_kind || "menu_item"}|${target.id}`;
      if (!linkedTargets.has(key)) {
        findings.push({
          severity: "WARNING",
          code: "missing_nac_identity",
          message: `${target.name_en || target.id} has no NAC code. It was not assigned by name.`,
          itemId: target.id,
        });
      }
    }
  }
  return findings;
}
