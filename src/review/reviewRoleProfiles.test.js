import {
  generateHumanizedReview,
  resetReviewDiversityState,
} from "./reviewGeneratorEngine";
import {
  containsConsultantLanguage,
  containsForbiddenExecutiveLanguage,
  containsAiPunctuation,
  isManagementHonorificRole,
  managementHonorificPresent,
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
  assistant_manager: { role: "assistant manager", hour: 20 },
};

const FRONTLINE_SIGNALS =
  /\b(attentive|our table|checking on us|shoutout|took care|handled our table|was on it|kept checking|friendly|smooth|helpful|service)\b/i;
const WAITER_ONLY_SIGNALS =
  /\b(attentive|handled our table|kept checking on us|shoutout to|took care of everything|was on it)\b/i;
const GM_GUEST_SIGNALS =
  /\b(mr\.|visible presence|smooth|organized|welcomed|come back|would return|returning|busy|staff worked|felt|around during|checking in|on the floor)\b/i;
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
    expect(resolveRoleCategory("branch manager")).toBe(ROLE_CATEGORIES.EXECUTIVE);
    expect(resolveRoleCategory("restaurant manager")).toBe(ROLE_CATEGORIES.MANAGEMENT);
    expect(resolveRoleCategory("assistant manager")).toBe(ROLE_CATEGORIES.MANAGEMENT);
    expect(resolveRoleCategory("supervisor")).toBe(ROLE_CATEGORIES.SUPERVISORY);
    expect(resolveRoleCategory("waiter")).toBe(ROLE_CATEGORIES.FRONTLINE);
  });

  test("management honorific roles include gm and branch manager", () => {
    expect(isManagementHonorificRole("gm")).toBe(true);
    expect(isManagementHonorificRole("branch manager")).toBe(true);
    expect(isManagementHonorificRole("restaurant manager")).toBe(true);
    expect(isManagementHonorificRole("assistant manager")).toBe(true);
    expect(isManagementHonorificRole("waiter")).toBe(false);
  });

  test("generates distinct role tones per acceptance roles", () => {
    const waiterTexts = generateRoleBatch("waiter", 20);
    const receptionTexts = generateRoleBatch("receptionist", 20);
    const supervisorTexts = generateRoleBatch("supervisor", 20);
    const rmTexts = generateRoleBatch("restaurant_manager", 20);
    const gmTexts = generateRoleBatch("general_manager", 20);

    const waiterFrontline = waiterTexts.filter((t) => scorePattern(t, FRONTLINE_SIGNALS)).length;
    const gmGuestStyle = gmTexts.filter((t) => scorePattern(t, GM_GUEST_SIGNALS)).length;
    const gmForbidden = gmTexts.filter((t) => containsForbiddenExecutiveLanguage(t)).length;
    const gmConsultant = gmTexts.filter((t) => containsConsultantLanguage(t)).length;
    const rmHonorific = rmTexts.filter((t) => managementHonorificPresent(t)).length;
    const supSignals = supervisorTexts.filter((t) => scorePattern(t, SUPERVISORY_SIGNALS)).length;

    expect(waiterFrontline).toBeGreaterThanOrEqual(10);
    expect(gmGuestStyle).toBeGreaterThanOrEqual(14);
    expect(gmForbidden).toBe(0);
    expect(gmConsultant).toBe(0);
    expect(rmHonorific).toBe(20);
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

  test("50 GM reviews read like genuine guest reviews", () => {
    resetReviewDiversityState();
    const gmTexts = generateRoleBatch("general_manager", 50);

    gmTexts.forEach((t) => {
      expect(t).toMatch(/\bMr\.\s+Armel\b/i);
      expect(t.toLowerCase()).toMatch(/armel/);
      expect(containsForbiddenExecutiveLanguage(t)).toBe(false);
      expect(containsConsultantLanguage(t)).toBe(false);
      expect(containsAiPunctuation(t)).toBe(false);
      expect(t).not.toMatch(/[\u2013\u2014—–]/);
    });

    const guestStyle = gmTexts.filter((t) => scorePattern(t, GM_GUEST_SIGNALS)).length;
    expect(guestStyle).toBeGreaterThanOrEqual(40);

    const consultantHits = gmTexts.filter((t) => containsConsultantLanguage(t)).length;
    expect(consultantHits).toBe(0);
  });

  test("assistant manager reviews use Mr. honorific and guest tone", () => {
    const texts = generateRoleBatch("assistant_manager", 20);
    texts.forEach((t) => {
      expect(managementHonorificPresent(t)).toBe(true);
      expect(containsConsultantLanguage(t)).toBe(false);
    });
  });
});
