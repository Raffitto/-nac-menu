/**
 * Verification: 50+ sample reviews across branches with diversity checks.
 * Run: CI=true npm test -- --testPathPattern=reviewGeneratorEngine.verify --watchAll=false
 */

import {
  generateHumanizedReview,
  resetReviewDiversityState,
} from "./reviewGeneratorEngine";

const STAFF = ["Ronald", "Azhar", "Rana", "Mohamed", "Boyboy"];
const BRANCHES = ["khobar", "riyadh", "jeddah"];
const roles = ["waiter", "receptionist", "supervisor"];

function openingPrefix(text) {
  return text.toLowerCase().slice(0, 40);
}

describe("review diversity humanization", () => {
  beforeEach(() => {
    resetReviewDiversityState();
  });

  it("generates 60 varied reviews with waiter names and meal realism", () => {
    const samples = [];
    const openings = new Set();
    const personalities = new Set();
    const lengths = { very_short: 0, medium: 0, detailed: 0, long_story: 0 };

    for (let i = 0; i < 60; i++) {
      const branch = BRANCHES[i % BRANCHES.length];
      const staff = STAFF[i % STAFF.length];
      const role = roles[i % roles.length];
      const hour = i % 3 === 0 ? 9 : i % 3 === 1 ? 14 : 20;
      const scanTime = new Date(`2026-05-24T${String(hour).padStart(2, "0")}:30:00+03:00`);

      const text = generateHumanizedReview({
        staffName: staff,
        role,
        branchId: branch,
        language: "en",
        scanTime,
      });

      expect(text.length).toBeGreaterThan(0);
      expect(text.toLowerCase()).toContain(staff.toLowerCase());

      samples.push({ branch, staff, hour, text, len: text.length });
      openings.add(openingPrefix(text));

      const dbg = globalThis.__NAC_REVIEW_DIVERSITY_DEBUG__;
      if (dbg?.personality) personalities.add(dbg.personality);
      if (dbg?.lengthClass) lengths[dbg.lengthClass] = (lengths[dbg.lengthClass] || 0) + 1;

      if (hour >= 20) {
        expect(text.toLowerCase()).not.toMatch(/eggs florentine|french toast|pancakes/);
      }
    }

    expect(samples.length).toBe(60);
    expect(openings.size).toBeGreaterThan(25);
    expect(personalities.size).toBeGreaterThan(5);

    const shortCount = samples.filter((s) => s.len < 80).length;
    const longCount = samples.filter((s) => s.len > 180).length;
    expect(shortCount).toBeGreaterThanOrEqual(5);
    expect(longCount).toBeGreaterThanOrEqual(1);

    // eslint-disable-next-line no-console
    console.log("DIVERSITY SAMPLE STATS", {
      uniqueOpenings: openings.size,
      personalities: personalities.size,
      lengthClasses: lengths,
      shortReviews: shortCount,
      longReviews: longCount,
    });
  });
});
