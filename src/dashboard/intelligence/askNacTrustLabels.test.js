import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import {
  getMobileConnectionBadge,
  getMobileTrustSummary,
  getTechnicalTrustDetails,
} from "./askNacTrustLabels";

describe("askNacTrustLabels", () => {
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

  test("connection badge uses user-facing labels", () => {
    expect(
      getMobileConnectionBadge({
        lastResponse: { answerType: ANSWER_TYPES.METRIC, localFallback: true },
        session: null,
        serverConfigured: true,
      }).shortLabel,
    ).toBe("Partial Data");
  });
});
