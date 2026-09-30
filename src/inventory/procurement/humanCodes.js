/**
 * Human inventory codes are display identities. Database identity stays a UUID.
 * Codes are never recycled. CL is matched before C so cleaning does not become consumable.
 */

export const CODE_FAMILIES = Object.freeze({
  FOOD: "F",
  BAR: "B",
  CONSUMABLE: "C",
  CLEANING: "CL",
  PACKAGING: "P",
  EQUIPMENT: "E",
  MAINTENANCE: "M",
});

const FAMILY_ORDER = ["CL", "F", "B", "C", "P", "E", "M"];

export function familyPrefix(family) {
  const key = String(family || "").toUpperCase();
  if (CODE_FAMILIES[key]) return CODE_FAMILIES[key];
  if (FAMILY_ORDER.includes(key)) return key;
  return null;
}

export function parseHumanCode(code) {
  const match = String(code || "").trim().toUpperCase().match(/^(CL|[FBCEPM])(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]) };
}

export function nextHumanCode(family, existingCodes = []) {
  const prefix = familyPrefix(family);
  if (!prefix) {
    return { code: null, reason: "unknown_family" };
  }
  let max = 0;
  for (const raw of existingCodes) {
    const parsed = parseHumanCode(raw);
    if (parsed?.prefix === prefix) max = Math.max(max, parsed.number);
  }
  return { code: `${prefix}${max + 1}`, prefix, number: max + 1, reason: null };
}

export function assertCodeAvailable(code, existingCodes = []) {
  const parsed = parseHumanCode(code);
  if (!parsed) return { ok: false, reason: "invalid_code" };
  const taken = existingCodes.some((row) => String(row).toUpperCase() === `${parsed.prefix}${parsed.number}`);
  if (taken) return { ok: false, reason: "code_already_issued" };
  return { ok: true, reason: null, code: `${parsed.prefix}${parsed.number}` };
}
