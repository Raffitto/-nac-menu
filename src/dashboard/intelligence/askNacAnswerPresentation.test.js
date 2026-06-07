import { formatMobileAnswerLead } from "./askNacAnswerPresentation";
import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";

describe("formatMobileAnswerLead", () => {
  test("humanizes menu QR scan answers while preserving count", () => {
    const lead = formatMobileAnswerLead({
      answerType: ANSWER_TYPES.METRIC,
      directAnswer: "18 menu qr scans for Network (all branches).",
    });
    expect(lead).toContain("18");
    expect(lead.toLowerCase()).toContain("menu qr scans");
  });

  test("humanizes category revenue answers while preserving SAR amount", () => {
    const lead = formatMobileAnswerLead({
      answerType: ANSWER_TYPES.METRIC,
      directAnswer: "Food category generated SAR 145,723.00",
    });
    expect(lead).toContain("SAR 145,723.00");
    expect(lead.toLowerCase()).toContain("food");
  });

  test("preserves AI-generated conversational answers", () => {
    const directAnswer =
      "Yesterday the network recorded 18 menu QR scans across all branches during the evening shift.";
    expect(
      formatMobileAnswerLead({
        answerType: ANSWER_TYPES.METRIC,
        isAiGenerated: true,
        directAnswer,
      }),
    ).toBe(directAnswer);
  });

  test("does not drop numeric values from net sales answers", () => {
    const lead = formatMobileAnswerLead({
      answerType: ANSWER_TYPES.METRIC,
      directAnswer: "SAR 12,000.00 net sales for Khobar (May 2026).",
    });
    expect(lead).toContain("12,000.00");
    expect(lead).toContain("SAR");
  });
});
