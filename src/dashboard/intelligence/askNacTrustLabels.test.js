import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import {
  getMobileConnectionBadge,
  getMobileTrustSummary,
  getTechnicalTrustDetails,
} from "./askNacTrustLabels";

describe("askNacTrustLabels", () => {
  test("maps limitation answers away from high confidence", () => {
    expect(
      getMobileTrustSummary({
        answerType: "unavailable",
        answerConfidence: "limitation",
        confidence: "none",
        serverConnected: true,
      }).label,
    ).toBe("Verified limitation");
  });

  test("maps verified deterministic to Verified Data", () => {
    expect(
      getMobileTrustSummary({
        answerType: ANSWER_TYPES.METRIC,
        serverConnected: true,
        localFallback: false,
        isAiGenerated: false,
      }).label,
    ).toBe("Verified Data");
  });

  test("maps AI narrated to AI Explained", () => {
    expect(
      getMobileTrustSummary({
        answerType: ANSWER_TYPES.METRIC,
        isAiGenerated: true,
      }).label,
    ).toBe("AI Explained");
  });

  test("maps local fallback to Partial Data", () => {
    expect(
      getMobileTrustSummary({
        answerType: ANSWER_TYPES.METRIC,
        localFallback: true,
      }).label,
    ).toBe("Partial Data");
  });

  test("maps error to Data Unavailable", () => {
    expect(getMobileTrustSummary({ answerType: ANSWER_TYPES.ERROR }).label).toBe("Data Unavailable");
  });

  test("keeps technical labels in details", () => {
    const rows = getTechnicalTrustDetails({
      serverConnected: true,
      localFallback: true,
      confidence: "high",
    });
    expect(rows.some((row) => row.value === "Local fallback")).toBe(true);
    expect(rows.some((row) => row.value === "high confidence")).toBe(true);
  });

  test("shows resolved question in technical details", () => {
    const rows = getTechnicalTrustDetails({
      conversationResolution: {
        usedContext: true,
        resolvedQuestion: "Who drove the most Google redirects last month?",
      },
      serverConnected: true,
      confidence: "high",
    });
    expect(rows.some((row) => row.label === "Resolved as")).toBe(true);
  });
});
