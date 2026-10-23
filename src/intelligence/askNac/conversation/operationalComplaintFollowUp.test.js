import { resolveFollowUpQuestion } from "./resolveFollowUpQuestion";

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

  test("does not invent a historical period when there is no prior scope", () => {
    const question = "Which of those complaints involved food quality?";
    const result = resolveFollowUpQuestion(question, {});
    expect(result.resolvedQuestion).toBe(question);
  });
});
