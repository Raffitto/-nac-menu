import {
  parseTeachNacCommand,
  inferOperatorMemoryCategory,
} from "./teachNacParser";
import {
  parseManualInputAnswer,
  isLikelyManualInputAnswer,
  WEEKLY_DASHBOARD_FIELD_DEFS,
} from "./manualInputParser";
import {
  matchMemoryToGuestQuestion,
  buildMemoryHypotheses,
} from "./executiveMemory";
import { resolveWeekEndingPeriod, buildWeeklyDashboardAnswerLines } from "./weeklyDashboardSession";

describe("Teach NAC parser", () => {
  test("parses Teach NAC command", () => {
    const result = parseTeachNacCommand("Teach NAC: Humidity above 70% reduces walk-ins.");
    expect(result?.fact).toBe("Humidity above 70% reduces walk-ins.");
  });

  test("parses Remember this command", () => {
    const result = parseTeachNacCommand("Remember this: Patio closes after 10pm.");
    expect(result?.fact).toContain("Patio closes");
  });

  test("infers weather category", () => {
    expect(inferOperatorMemoryCategory("Humidity above 70% reduces walk-ins.")).toBe("weather");
  });
});

describe("Manual input parser", () => {
  test("parses 82 covers", () => {
    const parsed = parseManualInputAnswer("82 covers", WEEKLY_DASHBOARD_FIELD_DEFS);
    expect(parsed?.metricKey).toBe("seven_rooms_covers");
    expect(parsed?.metricValue).toBe(82);
  });

  test("parses bare number when one field expected", () => {
    const parsed = parseManualInputAnswer("82", WEEKLY_DASHBOARD_FIELD_DEFS);
    expect(parsed?.metricValue).toBe(82);
  });

  test("isLikelyManualInputAnswer when awaiting input", () => {
    expect(isLikelyManualInputAnswer("82 covers", { pendingSessionId: "abc", awaitingInput: true })).toBe(true);
    expect(isLikelyManualInputAnswer("Teach NAC: foo", { pendingSessionId: "abc", awaitingInput: true })).toBe(false);
  });
});

describe("Executive memory matching", () => {
  test("matches humidity fact to guest question", () => {
    const memories = [{ fact: "Humidity above 70% reduces walk-ins.", source: "operator_memory" }];
    const matches = matchMemoryToGuestQuestion("Why were guests down?", memories);
    expect(matches).toHaveLength(1);
    const hypotheses = buildMemoryHypotheses(matches);
    expect(hypotheses[0].attribution).toContain("previously taught operator knowledge");
  });
});

describe("Weekly dashboard helpers", () => {
  test("resolveWeekEndingPeriod returns week bounds", () => {
    const period = resolveWeekEndingPeriod("", new Date("2026-06-23T12:00:00Z"));
    expect(period.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(period.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(period.periodLabel).toContain("week ending");
  });

  test("buildWeeklyDashboardAnswerLines includes manual covers", () => {
    const lines = buildWeeklyDashboardAnswerLines({
      branchLabel: "Khobar",
      vaultPeriod: { periodLabel: "week ending 2026-06-15" },
      manualInputs: { seven_rooms_covers: 82 },
      aggregation: { totalSales: 100000, dayCount: 5, totalGuests: 400 },
    });
    const text = lines.join("\n");
    expect(text).toContain("7Rooms covers: 82");
    expect(text).toContain("Weekly dashboard · Khobar");
  });
});
