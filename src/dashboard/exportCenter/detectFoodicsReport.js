import { detectImportTypeFromHeaders, findFoodicsHeaderAndData } from "../utils/foodicsParser";
import { IMPORT_TYPE } from "../config/foodicsImportTypes";

function norm(h) {
  return String(h || "").toLowerCase().trim();
}

export function classifyFoodicsReport(headers = []) {
  const h = headers.map(norm);
  const hasCreator = h.some((c) => c === "creator" || c.includes("creator"));
  const hasProduct = h.some((c) => c === "product" || c === "item" || c === "product name");
  const hasGuests = h.some((c) => c.includes("guest"));
  const hasOrders = h.some((c) => c.includes("order") && !c.includes("border"));

  if (hasCreator && hasProduct) {
    return {
      detected: IMPORT_TYPE.WAITER_PRODUCT_SALES,
      label: "Sales by Product by Creator",
    };
  }
  if (hasCreator && (hasGuests || hasOrders || !hasProduct)) {
    return {
      detected: IMPORT_TYPE.SALES_BY_CREATOR,
      label: "Sales by Creator",
    };
  }
  return {
    detected: detectImportTypeFromHeaders(headers) || IMPORT_TYPE.PRODUCT_SALES,
    label: "Product Sales",
  };
}

export function validateUploadForNeed(headers, neededType) {
  const classified = classifyFoodicsReport(headers);
  if (!neededType || classified.detected === neededType) {
    return { ok: true, ...classified };
  }
  const neededLabel =
    neededType === IMPORT_TYPE.SALES_BY_CREATOR
      ? "Sales by Creator"
      : neededType === IMPORT_TYPE.WAITER_PRODUCT_SALES
        ? "Sales by Product by Creator"
        : neededType;
  return {
    ok: false,
    ...classified,
    error: `This looks like ${classified.label}. ${neededLabel} is required.`,
  };
}

export function headersFromMatrix(matrix) {
  return findFoodicsHeaderAndData(matrix).headers;
}
