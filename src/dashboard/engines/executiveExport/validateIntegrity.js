/**
 * Executive export integrity validation — post-build checks for leadership-safe output.
 */

import { canonicalStaffName } from "../../config/staffRoles";
import {
  isExecutiveEligibleAggregatedItem,
  isSymbolOrMaskedItemName,
} from "./executiveItemIntegrity";

function checkItemSection(section, sectionId, issues) {
  (section?.rows || []).forEach((row) => {
    if (!row.item_name) {
      issues.push(`${sectionId}: anonymous item row`);
      return;
    }
    if (isSymbolOrMaskedItemName(row.item_name)) {
      issues.push(`${sectionId}: masked/symbol item "${String(row.item_name).slice(0, 20)}"`);
    }
    if ((Number(row.net_sales) || 0) <= 0) {
      issues.push(`${sectionId}: zero SAR row "${row.item_name}"`);
    }
    if (!isExecutiveEligibleAggregatedItem(row)) {
      issues.push(`${sectionId}: ineligible item "${row.item_name}"`);
    }
  });
}

function checkWaiterSection(section, sectionId, issues) {
  const names = (section?.rows || []).map((r) => canonicalStaffName(r.waiter || r.name));
  const seen = new Set();
  names.forEach((n) => {
    if (!n || n === "Unassigned") {
      issues.push(`${sectionId}: anonymous waiter row`);
      return;
    }
    const key = n.toLowerCase();
    if (seen.has(key)) {
      issues.push(`${sectionId}: duplicate waiter identity "${n}"`);
    }
    seen.add(key);
  });
}

function contributionSumsTo100(section, valueKey = "contribution_pct") {
  const rows = section?.rows || [];
  if (!rows.length) return true;
  const sum = rows.reduce((a, r) => a + (Number(r[valueKey]) || 0), 0);
  return Math.abs(sum - 100) <= 0.6;
}

/**
 * @param {{ sections?: object, summary?: object }} pkg
 */
export function validateExecutiveExportIntegrity(pkg) {
  const sections = pkg?.sections || pkg || {};
  const issues = [];

  checkItemSection(sections.topItems, "topItems", issues);
  checkItemSection(sections.bottomItems, "bottomItems", issues);
  checkWaiterSection(sections.waiterSales, "waiterSales", issues);
  checkWaiterSection(sections.waiterUpsell, "waiterUpsell", issues);
  checkWaiterSection(sections.khobarGoogle, "khobarGoogle", issues);

  if (sections.topItems?.rows?.length && !contributionSumsTo100(sections.topItems)) {
    issues.push("topItems: share % does not sum to 100%");
  }
  if (sections.waiterSales?.rows?.length && !contributionSumsTo100(sections.waiterSales)) {
    issues.push("waiterSales: share % does not sum to 100%");
  }

  if (pkg?.summary?.top_seller?.item && isSymbolOrMaskedItemName(pkg.summary.top_seller.item)) {
    issues.push("summary: top seller is masked/invalid");
  }
  if (pkg?.summary?.top_seller?.sales) {
    const salesStr = String(pkg.summary.top_seller.sales);
    if (/^0\.00\s*SAR$/i.test(salesStr.trim())) {
      issues.push("summary: top seller has zero SAR display");
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    checks_run: [
      "no_anonymous_items",
      "no_symbol_rows",
      "no_zero_sar_top_least",
      "no_duplicate_waiters",
      "contribution_pct_100",
      "summary_top_seller_valid",
    ],
  };
}
