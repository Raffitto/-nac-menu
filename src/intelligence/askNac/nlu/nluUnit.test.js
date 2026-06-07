/**
 * NLU normalization and ambiguity resolution tests.
 */

import { normalizeAskNacQuestion } from "./normalizeQuestion";
import { resolveIntentFromScores, inferFallbackIntent } from "./resolveIntentAmbiguity";

describe("normalizeAskNacQuestion", () => {
  test("maps reviews to google review count phrasing", () => {
    const result = normalizeAskNacQuestion("How many reviews was done last month");
    expect(result.text.toLowerCase()).toMatch(/google review/);
    expect(result.hints.reviews).toBe(true);
  });

  test("maps best selling to top items", () => {
    const result = normalizeAskNacQuestion("What is the best selling in the NAC restaurant");
    expect(result.text.toLowerCase()).toMatch(/top/);
    expect(result.hints.topItems).toBe(true);
  });

  test("maps waiter performance to redirect leaderboard phrasing", () => {
    const result = normalizeAskNacQuestion("Which waiter performs best");
    expect(result.text.toLowerCase()).toMatch(/waiter.*redirect|redirect.*waiter/);
  });
});

describe("resolveIntentFromScores", () => {
  test("prefers dominant intent above 70% ratio", () => {
    const resolved = resolveIntentFromScores(
      [
        { id: "google_reviews", score: 16 },
        { id: "review_qr_scans", score: 4 },
      ],
      "google reviews this month",
      { reviews: true },
    );
    expect(resolved.intent).toBe("google_reviews");
    expect(resolved.confidence).not.toBe("none");
  });

  test("falls back to google reviews for review-only phrasing", () => {
    const resolved = inferFallbackIntent("reviews this month", { reviews: true });
    expect(resolved.id).toBe("google_reviews");
  });
});
