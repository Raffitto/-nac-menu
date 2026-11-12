import baseline from "../../catalogue/guest-menu-baseline-khobar.json";
import { buildOrderingCatalogue } from "../catalogueAdapter";

export function khobarCatalogueLines() {
  const catalogue = buildOrderingCatalogue(baseline, { branchId: "khobar" });
  return catalogue.ok ? catalogue.lines : [];
}

export function menuFromLines(lines) {
  return (lines || []).filter((line) => line.available !== false).map((line) => ({
    id: line.itemId,
    name: line.name,
    price: line.price,
    modifiers: line.modifiers,
    available: line.available,
  }));
}
