import { assessOperationalHealth } from "./operationalHealthEngine";

describe("assessOperationalHealth", () => {
  test("returns watch when sample is too small", () => {
    const r = assessOperationalHealth({ sessions: 2 });
    expect(r.status).toBe("watch");
    expect(r.label).toBe("Watch");
  });

  test("returns healthy for strong signals", () => {
    const r = assessOperationalHealth({
      sessions: 120,
      bouncePct: 18,
      deepPct: 22,
      addOnRate: 12,
      returningPct: 20,
      reviewConversionPct: 24,
      avgTimeSpent: 90,
      itemOpens: 200,
    });
    expect(r.status).toBe("healthy");
  });

  test("returns risk for high bounce and low review conversion", () => {
    const r = assessOperationalHealth({
      sessions: 80,
      bouncePct: 52,
      deepPct: 5,
      addOnRate: 2,
      returningPct: 6,
      reviewConversionPct: 5,
      avgTimeSpent: 20,
      itemOpens: 60,
    });
    expect(r.status).toBe("risk");
  });
});
