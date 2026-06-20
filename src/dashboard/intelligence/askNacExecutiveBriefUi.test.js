import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import { ASK_NAC_INTENTS } from "../../intelligence/askNac/intentRouter";
import { shouldRenderCashUpExecutiveBrief } from "./askNacExecutiveBriefUi";

const SAMPLE_BRIEF = {
  executiveSummary: "Khobar cash-up summary.",
  keyFindings: ["Net sales: 17,941.739 SAR"],
  operationalRisks: ["Coverage is partial."],
  recommendedActions: ["Confirm totals against source workbook."],
  dataSources: ["Cash up 2026.xlsx"],
};

describe("shouldRenderCashUpExecutiveBrief", () => {
  test("returns true for routed cash-up executive responses with executiveBrief", () => {
    expect(
      shouldRenderCashUpExecutiveBrief({
        answerType: ANSWER_TYPES.EXECUTIVE,
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        executiveBrief: SAMPLE_BRIEF,
      }),
    ).toBe(true);
  });

  test("returns false when executiveBrief is missing", () => {
    expect(
      shouldRenderCashUpExecutiveBrief({
        answerType: ANSWER_TYPES.EXECUTIVE,
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        executiveBrief: null,
      }),
    ).toBe(false);
  });

  test("returns false for non-cash-up intents even with executiveBrief", () => {
    expect(
      shouldRenderCashUpExecutiveBrief({
        answerType: ANSWER_TYPES.EXECUTIVE,
        intent: ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS,
        executiveBrief: SAMPLE_BRIEF,
      }),
    ).toBe(false);
  });

  test("returns false when answerType is not executive", () => {
    expect(
      shouldRenderCashUpExecutiveBrief({
        answerType: ANSWER_TYPES.METRIC,
        intent: ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY,
        executiveBrief: SAMPLE_BRIEF,
      }),
    ).toBe(false);
  });
});
