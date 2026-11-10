const RECONSTRUCTED_LIMIT = "Recalculated from the current catalogue. Not a verified historical price.";

function decimalToMinor(value) {
  if (typeof value === "number" && Number.isInteger(value)) value = String(value);
  const text = String(value ?? "").replace(/,/g, "").trim();
  const match = text.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  if ((match[2] || "").length > 2) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || whole > 100000000) return null;
  return whole * 100 + fraction;
}

function buildPriceSnapshot({ item, quantity, modifiers }) {
  const baseUnitMinor = decimalToMinor(item?.price);
  const qty = Number(quantity);
  if (baseUnitMinor == null || !Number.isInteger(qty) || qty < 1 || qty > 99) return null;
  const stored = [];
  let extra = 0;
  for (const modifier of modifiers || []) {
    const unitMinor = decimalToMinor(modifier?.price);
    const name = String(modifier?.name || "").trim();
    const id = String(modifier?.id || "").trim();
    if (unitMinor == null || !name || !id) return null;
    stored.push({ id, name, unitMinor });
    extra += unitMinor;
  }
  const unitMinor = baseUnitMinor + extra;
  const lineMinor = unitMinor * qty;
  if (!Number.isSafeInteger(lineMinor)) return null;
  return {
    catalogueItemId: item?.id ? String(item.id) : null,
    name: item?.name_en || item?.name || null,
    quantity: qty,
    baseUnitMinor,
    modifiers: stored,
    unitMinor,
    lineMinor,
    currency: "SAR",
    taxMinor: null,
    taxNote: "Tax is not recorded on this check.",
  };
}

function sumStoredMinor(lines) {
  const rows = lines || [];
  if (!rows.length) return { minor: null, provenance: "empty" };
  let minor = 0;
  let provenance = "snapshot";
  for (const line of rows) {
    if (!Number.isInteger(line?.lineMinor)) return { minor: null, provenance: "unavailable" };
    if (line.provenance !== "snapshot") provenance = "reconstructed";
    minor += line.lineMinor;
  }
  return { minor, provenance };
}

module.exports = {
  RECONSTRUCTED_LIMIT,
  decimalToMinor,
  buildPriceSnapshot,
  sumStoredMinor,
};
