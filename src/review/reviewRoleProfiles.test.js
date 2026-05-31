import {
  generateHumanizedReview,
  resetReviewDiversityState,
} from "./reviewGeneratorEngine";
import {
  containsForbiddenExecutiveLanguage,
  resolveRoleCategory,
  ROLE_CATEGORIES,
} from "./reviewRoleProfiles";

const BRANCHES = ["khobar", "riyadh", "jeddah"];
const STAFF = "Armel";

const ROLE_SAMPLES = {
  waiter: { role: "waiter", hour: 20 },
  receptionist: { role: "receptionist", hour: 12 },
  supervisor: { role: "supervisor", hour: 20 },
  restaurant_manager: { role: "restaurant manager", hour: 20 },
  general_manager: { role: "gm", hour: 20 },
};

const FRONTLINE_SIGNALS =
  /\b(attentive|our table|checking on us|shoutout|took care|handled our table|was on it|kept checking|friendly|smooth|helpful|service)\b/i;
const WAITER_ONLY_SIGNALS =
  /\b(attentive|handled our table|kept checking on us|shoutout to|took care of everything|was on it)\b/i;
const LEADERSHIP_SIGNALS =
  /\b(leadership|managed|management|operational|standards|team|coordination|guest satisfaction|professionally run|floor presence)\b/i;
const SUPERVISORY_SIGNALS =
  /\b(floor|supervis|coordinated|organized|team|flow|resolved)\b/i;

function scorePattern(text, re) {
  return re.test(text) ? 1 : 0;
}

function generateRoleBatch(roleKey, count = 20) {
  const cfg = ROLE_SAMPLES[roleKey];
  const texts = [];
  for (let i = 0; i < count; i++) {
    const branch = BRANCHES[i % BRANCHES.length];
    const scanTime = new Date(`2026-05-24T${String(cfg.hour).padStart(2, "0")}:30:00+03:00`);
    texts.push(
      generateHumanizedReview({
        staffName: STAFF,
        role: cfg.role,
        branchId: branch,
        language: "en",
        scanTime,
      }),
    );
  }
  return texts;
}

describe("reviewRoleProfiles", () => {
  beforeEach(() => {
    resetReviewDiversityState();
  });

  test("maps leadership roles to correct categories", () => {
    expect(resolveRoleCategory("gm")).toBe(ROLE_CATEGORIES.EXECUTIVE);
    expect(resolveRoleCategory("general manager")).toBe(ROLE_CATEGORIES.EXECUTIVE);
    expect(resolveRoleCategory("restaurant manager")).toBe(ROLE_CATEGORIES.MANAGEMENT);
    expect(resolveRoleCategory("assistant manager")).toBe(ROLE_CATEGORIES.MANAGEMENT);
    expect(resolveRoleCategory("supervisor")).toBe(ROLE_CATEGORIES.SUPERVISORY);
    expect(resolveRoleCategory("waiter")).toBe(ROLE_CATEGORIES.FRONTLINE);
  });

  test("generates 20 distinct role tones per acceptance roles", () => {
    const waiterTexts = generateRoleBatch("waiter", 20);
    const receptionTexts = generateRoleBatch("receptionist", 20);
    const supervisorTexts = generateRoleBatch("supervisor", 20);
    const rmTexts = generateRoleBatch("restaurant_manager", 20);
    const gmTexts = generateRoleBatch("general_manager", 20);

    const waiterFrontline = waiterTexts.filter((t) => scorePattern(t, FRONTLINE_SIGNALS)).length;
    const gmLeadership = gmTexts.filter((t) => scorePattern(t, LEADERSHIP_SIGNALS)).length;
    const gmForbidden = gmTexts.filter((t) => containsForbiddenExecutiveLanguage(t)).length;
    const rmLeadership = rmTexts.filter((t) => scorePattern(t, LEADERSHIP_SIGNALS)).length;
    const supSignals = supervisorTexts.filter((t) => scorePattern(t, SUPERVISORY_SIGNALS)).length;

    expect(waiterFrontline).toBeGreaterThanOrEqual(10);
    expect(gmLeadership).toBeGreaterThanOrEqual(14);
    expect(gmForbidden).toBe(0);
    expect(rmLeadership).toBeGreaterThanOrEqual(14);
    expect(supSignals).toBeGreaterThanOrEqual(10);

    const gmVsWaiterOverlap = gmTexts.filter((t) => scorePattern(t, WAITER_ONLY_SIGNALS)).length;
    expect(gmVsWaiterOverlap).toBeLessThanOrEqual(3);

    const uniqueGm = new Set(gmTexts.map((t) => t.slice(0, 80)));
    const uniqueWaiter = new Set(waiterTexts.map((t) => t.slice(0, 80)));
    expect(uniqueGm.size).toBeGreaterThan(12);
    expect(uniqueWaiter.size).toBeGreaterThan(12);

    receptionTexts.forEach((t) => {
      expect(t.toLowerCase()).toMatch(/armel/);
      expect(t).toMatch(/welcom|seat|check-in|entrance|warm/i);
    });
  });
});
