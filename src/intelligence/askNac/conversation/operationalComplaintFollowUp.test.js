import { resolveFollowUpQuestion } from "./resolveFollowUpQuestion";
import { serverAnswerShouldYieldToLocal } from "../askNacClient";

describe("operational complaint follow-up continuity", () => {
  test("inherits exact historical range and branch", () => {
    const result = resolveFollowUpQuestion(
      "Which of those complaints involved food quality rather than service, and how were they handled?",
      { lastQuestion: "Summarize all guest complaints from October 1 to October 14 at NAC Khobar." },
    );
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toMatch(/October 1 and October 14/i);
    expect(result.resolvedQuestion).toMatch(/khobar/i);
    expect(result.resolvedQuestion).toMatch(/food quality/i);
  });

  test("a short food follow-up keeps the prior October window", () => {
    const result = resolveFollowUpQuestion(
      "Which of those were food related?",
      { lastQuestion: "What guest complaints occurred in Khobar between October 1 and October 14, 2026?" },
    );
    expect(result.usedContext).toBe(true);
    expect(result.resolvedQuestion).toMatch(/October 1 and October 14/i);
    expect(result.resolvedQuestion).toMatch(/khobar/i);
    expect(result.resolvedQuestion).toMatch(/food related/i);
  });

  test("a server answer that lost the calendar yields to the local register", () => {
    const yieldToLocal = serverAnswerShouldYieldToLocal(
      "Which of those were food related?",
      { intent: "vault_operational_review", directAnswer: "Vault data is not available, and a specific calendar day or month could not be parsed for this question." },
      { lastQuestion: "What guest complaints occurred in Khobar between October 1 and October 14, 2026?" },
    );
    expect(yieldToLocal).toBe(true);
  });

  test("does not invent a historical period when there is no prior scope", () => {
    const question = "Which of those complaints involved food quality?";
    const result = resolveFollowUpQuestion(question, {});
    expect(result.resolvedQuestion).toBe(question);
  });
});
