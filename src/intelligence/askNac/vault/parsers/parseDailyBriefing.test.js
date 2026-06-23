import {
  parseDailyBriefingReport,
  buildDailyBriefingJune2026Fixture,
} from "./parseDailyBriefing";

describe("parseDailyBriefingReport", () => {
  test("extracts reservations, MOD, focus points, item 86, hostess, staffing from June 2026 fixture", () => {
    const intermediate = buildDailyBriefingJune2026Fixture();
    const result = parseDailyBriefingReport(intermediate, {
      branchId: "khobar",
      fileId: "briefing-1",
      reportType: "daily_briefing",
    });

    expect(result.ok).toBe(true);
    expect(result.stats.sheetCount).toBe(2);
    expect(result.facts.some((fact) => fact.metric_key === "breakfast_reservations")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "dinner_reservations")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "mod_dinner")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "item_86")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "hostess")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "focus_points_line")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "staffing_notes_line")).toBe(true);
    expect(result.facts.some((fact) => fact.metric_key === "section_assignments_line")).toBe(true);
  });
});
