/**
 * Manager / executive PDF copy for proxy attachment opportunities.
 * Product-level Foodics exports cannot prove basket pairing.
 */

const PROXY_NOTE =
  "Proxy attach estimate — requires basket-level validation before treating as fixed loss.";

function fmt(n) {
  return Math.round(Number(n) || 0).toLocaleString();
}

function fmtPct(rate) {
  const n = Number(rate) || 0;
  if (n > 0 && n < 0.1) return "<0.1";
  return String(Math.round(n * 10) / 10);
}

function missedLine(pair) {
  if (pair.requiresBasketValidation) {
    return "Validate basket-level pairing needed — proxy attach only.";
  }
  const missed = pair.missedAddonOrders ?? 0;
  const sar = pair.estimatedLostRevenue ?? 0;
  if (missed <= 0 && sar <= 0) {
    return "No estimated missed gap at current proxy attach.";
  }
  return `Missed add-on opportunity: ~${fmt(missed)} orders | ~${fmt(sar)} SAR (estimated).`;
}

/** Operational narrative for PDF insight cards and financial leak rows. */
export function formatAttachmentOpportunityBody(pair) {
  if (!pair) return PROXY_NOTE;

  const rate = fmtPct(pair.attachmentRate);
  const parent = fmt(pair.parentOrders);
  const attached = fmt(pair.attachedOrders);
  const tail = `${missedLine(pair)} ${PROXY_NOTE}`;

  if (pair.id === "protein_pasta_risotto" || pair.id === "truffle_rigatoni") {
    return (
      `${parent} rigatoni/risotto orders sold. ${attached} protein add-ons sold. ` +
      `Estimated attach rate: ${rate}% (proxy). ${tail}`
    );
  }

  if (pair.id === "fries_burger") {
    const coverageLabel = pair.requiresBasketValidation
      ? "Fries volume exceeds burger/steak parents — validate basket-level pairing needed"
      : `Estimated fries attach coverage: ${rate}% (proxy)`;
    return (
      `${parent} burgers/steaks sold. ${attached} fries sold. ${coverageLabel}. ${tail}`
    );
  }

  return (
    `${parent} parent items · ${attached} add-on/proxy units · ` +
    `Estimated attach: ${rate}% vs ${pair.expectedPct}% target (proxy). ${tail}`
  );
}

export function formatAttachmentOpportunityTitle(pair) {
  if (pair?.id === "protein_pasta_risotto" || pair?.id === "truffle_rigatoni") {
    return "Protein add-ons with rigatoni / risotto";
  }
  if (pair?.id === "fries_burger") {
    return "Fries with burgers / steaks";
  }
  return pair?.label || "Attachment opportunity";
}

/** Compact row for manager PDF attachment table. */
export function formatAttachmentOpportunityTableRow(pair) {
  const rate = fmtPct(pair.attachmentRate);
  const sar = pair.requiresBasketValidation ? "—" : fmt(pair.estimatedLostRevenue);
  const target = pair.requiresBasketValidation ? "validate" : `${pair.expectedPct}%`;
  return [formatAttachmentOpportunityTitle(pair), `${rate}% (proxy)`, target, sar];
}

export const ATTACHMENT_PROXY_DISCLAIMER = PROXY_NOTE;

export const MENU_VISIBILITY_DISCLAIMER =
  "Menu views are tracked separately from Foodics sales. Product-level sales matching requires validated SKU/name mapping.";
