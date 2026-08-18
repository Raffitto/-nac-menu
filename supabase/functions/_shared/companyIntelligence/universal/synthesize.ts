/**
 * Management-grade synthesis from multi-domain evidence.
 * Association language only unless a verified causal claim exists.
 */

import { assessCausalLanguage } from "../causalPolicy.ts";
import type { UniversalExecution } from "./execute.ts";
import type { UniversalEvidence } from "./plan.ts";

function fmt(row: UniversalEvidence | undefined): string | null {
  if (!row || row.skipped || row.value == null) return null;
  if (typeof row.value === "number") {
    if (row.unit === "SAR" || row.metric === "net_sales" || row.metric === "avg_spend" || row.metric === "average_check") {
      return `SAR ${row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    if (row.metric === "delta_pct" || row.unit === "%") return `${row.value.toFixed(1)}%`;
    return String(row.value);
  }
  return String(row.value);
}

function periodLabel(exec: UniversalExecution): string {
  const p = exec.plan.period;
  if (!p) return "the selected period";
  return p.label || `${p.startDate} to ${p.endDate}`;
}

export function synthesizeUniversalManagement(exec: UniversalExecution): string {
  if (exec.plan.unavailable && !exec.evidence.some((e) => !e.skipped)) {
    return exec.plan.unavailable.reason;
  }
  const branch = exec.plan.branchScope[0] || "the branch";
  const period = periodLabel(exec);
  const sales = exec.evidence.find((e) => e.domain === "cash_up" && e.metric === "net_sales" && !e.skipped);
  const delta = exec.evidence.find((e) => e.domain === "cash_up" && e.metric === "delta_pct" && !e.skipped);
  const covers = exec.evidence.find((e) => e.domain === "cash_up" && e.metric === "covers" && !e.skipped);
  const avg = exec.evidence.find((e) => e.domain === "cash_up" && e.metric === "avg_spend" && !e.skipped)
    || exec.evidence.find((e) => e.domain === "commerce" && e.metric === "average_check" && !e.skipped);
  const commerce = exec.evidence.find((e) => e.domain === "commerce" && !e.skipped);
  const reviews = exec.evidence.find((e) => e.domain === "reviews");
  const ops = exec.evidence.find((e) => e.domain === "operations" && !e.skipped);

  const parts: string[] = [];
  if (sales) {
    const d = fmt(delta);
    parts.push(
      `Cash Up headline net sales for ${branch} (${period}) were ${fmt(sales)}`
      + (d ? ` (${Number(delta?.value) < 0 ? "down" : "up"} ${d} vs the comparison window)` : "")
      + ".",
    );
  } else if (exec.evidence.some((e) => e.domain === "cash_up" && e.skipped)) {
    parts.push("Cash Up headline sales were not available for this exact request.");
  }

  if (covers) parts.push(`Cash Up covers were ${fmt(covers)}.`);
  if (avg) parts.push(`Average spend/check evidence was ${fmt(avg)} (${avg.domain === "cash_up" ? "Cash Up avg spend" : "commerce average check"}).`);

  if (commerce?.text) {
    const clipped = commerce.text.replace(/Headline sales remain Cash Up[^.]*\./g, "").trim();
    parts.push(`Commerce basket/order evidence (not a substitute for headline sales): ${clipped}`);
  }

  if (reviews) {
    if (reviews.skipped) {
      parts.push(`Reviews: ${reviews.skipReason || "review facts were not available for this alignment."}`);
    } else if (reviews.text) {
      parts.push(`Reviews (association only): ${reviews.text.slice(0, 360)}`);
    } else {
      parts.push("Review-star facts were present but sparse for this window.");
    }
  }

  if (ops?.text) parts.push(`Operational notes: ${ops.text.slice(0, 280)}`);

  if (exec.conflicts.length) {
    parts.push(exec.conflicts.map((c) => c.statement).join(" "));
  }

  if (exec.drivers.length && (exec.plan.intent === "driver_analysis" || exec.plan.intent === "diagnostic")) {
    const names = exec.drivers.map((d) => d.driver.replace(/_/g, " ")).join(", ");
    parts.push(`Strongest associated drivers in the available legs: ${names}. This is association, not proof of causation.`);
  }

  if (exec.opportunities.length && (exec.plan.intent === "opportunity" || exec.plan.intent === "diagnostic" || exec.plan.intent === "follow_up")) {
    const top = exec.opportunities[0];
    parts.push(`Opportunity / focus: ${top.title}. ${top.rationale}`);
  }

  const missing = exec.evidence.filter((e) => e.skipped);
  if (missing.length && parts.length) {
    parts.push(`Incomplete legs: ${missing.map((m) => `${m.domain} (${m.skipReason || "unavailable"})`).join("; ")}.`);
  }

  if (exec.plan.unavailable) parts.push(exec.plan.unavailable.reason);

  if (!parts.length) {
    return "I could not assemble enough overlapping evidence across registered NAC domains for a management answer.";
  }

  const raw = parts.join(" ");
  const causal = assessCausalLanguage(raw, [], []);
  return causal.sanitizedText || raw;
}
