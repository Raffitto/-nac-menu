import assert from "node:assert/strict";
import { parseVaultPeriodFromQuestion } from "./vaultPeriodParser.ts";
import { resolvePlannerTimeExpression } from "./askNacManagementPlanner.ts";
import { isComparisonAnalysisFollowUp } from "./companyIntelligence/conversationFollowUp.ts";

const REF = new Date("2026-10-16T12:00:00+03:00");

Deno.test("edge: 2 days ago stays one date even if the planner says last 7 days", () => {
  const period = resolvePlannerTimeExpression(
    "last_7_days",
    "What was the sales 2 days ago?",
    REF,
  );
  assert.equal(period?.startDate, "2026-10-14");
  assert.equal(period?.endDate, "2026-10-14");
  assert.equal(period?.isSingleDay, true);
});

Deno.test("edge: September delivery question stays the full month", () => {
  const period = resolvePlannerTimeExpression(
    "last_7_days",
    "How much in September was delivery app sales, and how many total orders?",
    REF,
  );
  assert.equal(period?.startDate, "2026-09-01");
  assert.equal(period?.endDate, "2026-09-30");
  assert.equal(isComparisonAnalysisFollowUp(
    "How much in September was delivery app sales, and how many total orders?",
  ), false);
});

Deno.test("edge: yesterday and a named September parse directly", () => {
  assert.equal(parseVaultPeriodFromQuestion("sales yesterday", REF)?.startDate, "2026-10-15");
  const month = parseVaultPeriodFromQuestion("sales in September 2026", REF);
  assert.equal(month?.startDate, "2026-09-01");
  assert.equal(month?.endDate, "2026-09-30");
});
