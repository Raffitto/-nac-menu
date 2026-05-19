import * as XLSX from "xlsx";
import { businessDayExportNote } from "../utils/businessDay";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function tier(rank, total) {
  if (rank === 0) return "GOLD";
  if (rank === 1) return "SILVER";
  if (rank === 2) return "BRONZE";
  if (rank < total * 0.5) return "STRONG";
  return "WATCH";
}

function barCell(pct) {
  const filled = Math.round(Math.min(100, Math.max(0, pct)) / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${pct}%`;
}

function sectionOn(sections, key) {
  return sections?.[key] !== false;
}

export function exportExecutiveVisualXLSX(payload) {
  const {
    attachment,
    timeShift,
    heat,
    menuEngineering,
    waiters,
    waiterTargets,
    sortedProducts,
    insights,
    kpis,
    exportMeta,
    sections = {},
    staffOverview,
    weeklyFocusItems = [],
  } = payload;

  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString();
  const branch = exportMeta?.branch || "all";

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["NAC Hospitality OS — Executive Intelligence"],
      ["Generated", generated],
      ["Branch", branch],
      ["Period", exportMeta?.period || businessDayExportNote()],
      ["Target mode", exportMeta?.targetMode || "—"],
      [],
      ["KPI", "Value", "Visual"],
      ["Modifier revenue", attachment?.totals?.modifierRevenue || 0, barCell(75)],
      ["Parent orders", attachment?.totals?.parentOrders || 0, "—"],
      ["Active waiters", staffOverview?.waiterCount ?? waiters?.waiters?.length ?? 0, "—"],
      ["Managers (excluded)", staffOverview?.managerCount ?? 0, "—"],
      ["Missed upsells", attachment?.missedUpsells?.length || 0, attachment?.missedUpsells?.length > 2 ? "HIGH" : "OK"],
      ["Sessions", kpis?.sessions || "—", "—"],
      ["Peak daypart", timeShift?.peakDaypart?.label || "—", "—"],
      [],
      ["Weekly focus items", weeklyFocusItems.join(", ") || "General food & add-on upsell", "—"],
    ]),
    "Executive",
  );

  if (sectionOn(sections, "ai")) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        (insights || []).map((i) => ({
          Title: i.title,
          Body: i.body,
          Confidence: i.confidence,
          Type: i.type,
          Priority: i.confidence === "high" ? "HIGH" : "MEDIUM",
        })),
      ),
      "AI Insights",
    );
  }

  if (sectionOn(sections, "waiter") && waiters?.waiters?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        waiters.waiters.map((w, i) => ({
          Rank: i + 1,
          Tier: tier(i, waiters.waiters.length),
          Role: w.roleLabel,
          Waiter: w.waiter,
          Revenue: w.net_sales,
          Quantity: w.quantity,
          "Avg check": w.avgCheck,
          "Modifier %": w.modifierAttachPct,
          "Modifier visual": barCell(w.modifierAttachPct),
          "Food mix %": w.foodMixPct,
          "Food mix visual": barCell(w.foodMixPct || 0),
          "Beverage %": w.beverageAttachPct,
          "Beverage visual": barCell(w.beverageAttachPct),
          Strongest: w.strongestCategory,
          Weakest: w.weakestCategory,
          ...(weeklyFocusItems || []).reduce((acc, label) => {
            const fp = (w.focusPerformance || []).find((f) => f.label === label);
            acc[`Focus: ${label}`] = fp?.qty ?? 0;
            acc[`Focus SAR: ${label}`] = fp?.revenue ?? 0;
            return acc;
          }, {}),
        })),
      ),
      "Waiters",
    );
  }

  if (weeklyFocusItems?.length && waiters?.waiters?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        waiters.waiters.flatMap((w) =>
          weeklyFocusItems.map((label) => {
            const fp = (w.focusPerformance || []).find((f) => f.label === label);
            return {
              Waiter: w.waiter,
              "Focus item": label,
              Quantity: fp?.qty ?? 0,
              Revenue: fp?.revenue ?? 0,
              "Modifier %": w.modifierAttachPct,
              "Food mix %": w.foodMixPct,
            };
          }),
        ),
      ),
      "Weekly Focus",
    );
  }

  if (sectionOn(sections, "waiterTargets") && waiterTargets?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        waiterTargets.map((t) => ({
          Waiter: t.waiter,
          Severity: (t.severity || t.priority || "medium").toUpperCase(),
          Category: t.category,
          Headline: t.headline,
          "Coaching action": t.action,
          "Push next week": t.pushNextWeek,
          "Secondary note": t.secondaryNote || "",
          Revenue: t.net_sales,
          "Modifier %": t.modifierAttachPct,
          "Food mix %": t.foodMixPct,
          "Weekly focus weak": (t.focusWeak || []).map((f) => f.label).join(", "),
        })),
      ),
      "Weekly Targets",
    );
  }

  if (sectionOn(sections, "product") && sortedProducts?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        sortedProducts.slice(0, 80).map((p, i) => ({
          Rank: i + 1,
          Tier: tier(i, Math.min(80, sortedProducts.length)),
          Item: p.item_name,
          "Heat index": p.heatIndex,
          "Heat visual": barCell(p.heatPct || p.heatIndex || 0),
          Orders: p.orders,
          Views: p.views,
          Revenue: p.revenue,
        })),
      ),
      "Product Performance",
    );
  }

  if (sectionOn(sections, "attachment") && attachment?.pairs?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        attachment.pairs.map((p) => ({
          Pair: p.label,
          "Attach %": p.attachmentRate,
          Expected: p.expectedPct,
          "Progress visual": barCell((p.attachmentRate / Math.max(p.expectedPct, 1)) * 100),
          "Parent orders": p.parentOrders,
          "Est. gap SAR": p.estimatedLostRevenue,
          Status: p.underperforming ? "UNDER" : "OK",
        })),
      ),
      "Attachments",
    );
  }

  if (sectionOn(sections, "missed") && attachment?.missedUpsells?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        attachment.missedUpsells.map((m) => ({
          Pair: m.label,
          "Opportunity score": m.opportunityScore,
          "Attach %": m.attachmentRate,
          Expected: m.expectedPct,
          "Gap %": m.gap,
          "Est. SAR": m.estimatedLostRevenue,
          Heat: m.opportunityScore >= 50 ? "CRITICAL" : "WATCH",
        })),
      ),
      "Missed Upsells",
    );
  }

  if (sectionOn(sections, "menuEng") && menuEngineering?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        menuEngineering.map((m) => ({
          Item: m.item_name,
          Quadrant: m.quadrant,
          Popularity: m.popularity,
          Profitability: m.profitability,
          Views: m.views,
          Orders: m.orders,
          Flag: m.quadrant === "Star" ? "STAR" : m.quadrant === "Dog" ? "DOG" : "—",
        })),
      ),
      "Menu Engineering",
    );
  }

  if (sectionOn(sections, "heat") && heat?.items?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        heat.items.slice(0, 60).map((h, i) => ({
          Rank: i + 1,
          Item: h.item_name,
          "Heat index": h.heatIndex,
          Band: h.band,
          Tag: h.tag || "",
          "Heat visual": barCell(h.heatPct || 0),
        })),
      ),
      "Heat Scores",
    );
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `nac-executive-intelligence-${branch}.xlsx`,
  );
}

export function exportVisualIntelligenceXLSX(payload) {
  exportExecutiveVisualXLSX(payload);
}
