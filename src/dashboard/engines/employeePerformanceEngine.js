/** Employee performance classifications from review + menu attribution signals */

import { filterProductionStaffList } from "../utils/isProductionStaff";

const MIN_STRONG = 25;
const MIN_MODERATE = 10;
const MIN_EARLY = 4;

function confidenceLabel(sampleSize) {
  if (sampleSize >= MIN_STRONG) return "strong signal";
  if (sampleSize >= MIN_MODERATE) return "moderate confidence";
  if (sampleSize >= MIN_EARLY) return "early signal";
  return "low confidence";
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

/**
 * @param {Array} employees — from get_review_intelligence.top_employees or merged client data
 * @param {object} menuContext — optional { influencedSessions, dessertAttachments, beverageAttachments }
 */
export function buildEmployeePerformance(employees = [], menuContext = {}) {
  const list = filterProductionStaffList(Array.isArray(employees) ? employees : []);
  const influenced = menuContext.influencedSessions || {};

  return list.map((emp) => {
    const opens = Number(emp.opens) || 0;
    const generated = Number(emp.generated) || Number(emp.reviews_generated) || 0;
    const google = Number(emp.google_clicks) || 0;
    const sample = Math.max(opens, generated);
    const conv = generated > 0 ? pct(google, generated) : 0;
    const avgLen = Math.round(Number(emp.avg_length) || 0);
    const menuInfl = Number(influenced[emp.name]) || 0;

    const metrics = {
      scans_generated: opens,
      reviews_generated: generated,
      google_clicks: google,
      review_conversion_pct: conv,
      avg_generated_review_length: avgLen,
      menu_sessions_influenced: menuInfl,
      dessert_attachment_rate: menuContext.dessert_rate?.[emp.name] ?? null,
      beverage_attachment_rate: menuContext.beverage_rate?.[emp.name] ?? null,
      confidence: confidenceLabel(sample),
    };

    const classification = classifyEmployee(metrics, sample);
    return {
      name: emp.name,
      role: emp.role || "",
      metrics,
      classification,
    };
  });
}

function classifyEmployee(m, sample) {
  if (sample < MIN_EARLY) {
    return { label: "Underutilized Staff", reason: "Insufficient data — monitor before acting." };
  }

  const { reviews_generated: gen, review_conversion_pct: conv, menu_sessions_influenced: infl } = m;

  if (gen >= MIN_MODERATE && conv >= 40) {
    return {
      label: "Review Hunter",
      reason: "Strong card handoff with excellent guest-to-Google follow-through.",
    };
  }
  if (infl >= MIN_MODERATE && (m.dessert_attachment_rate > 15 || m.beverage_attachment_rate > 15)) {
    return { label: "Upsell Specialist", reason: "Menu sessions show attachment to high-margin categories." };
  }
  if (gen < MIN_EARLY && infl >= MIN_MODERATE) {
    return { label: "Silent Performer", reason: "Menu engagement without enough review card presentations." };
  }
  if (infl >= MIN_STRONG && conv < 15) {
    return {
      label: "High card, low Google",
      reason: "Card exposure is there — verbal close and redirect need work.",
    };
  }
  if (gen >= MIN_EARLY && conv >= 25 && infl >= MIN_EARLY) {
    return {
      label: "Service closer",
      reason: "Consistent end-of-service card handoff and review completion.",
    };
  }
  if (gen >= MIN_MODERATE && conv < 20) {
    return {
      label: "Guest favorite",
      reason: "Reviews generate well — coach post-review Google redirect.",
    };
  }

  return {
    label: "Underutilized Staff",
    reason: "Present review card more often before guest disengages.",
  };
}

export function topPerformersByMetric(performance, metricKey, limit = 5) {
  return [...performance]
    .sort((a, b) => (b.metrics[metricKey] || 0) - (a.metrics[metricKey] || 0))
    .slice(0, limit);
}
