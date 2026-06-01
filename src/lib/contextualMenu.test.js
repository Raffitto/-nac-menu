import { getContextualFlow } from "./contextualMenu";

/** Build a Date whose Asia/Riyadh wall clock is the given weekday and local time (UTC+3, no DST). */
function riyadhDate(weekdayEn, hour, minute = 0) {
  const base = {
    Sun: "2026-01-04",
    Mon: "2026-01-05",
    Tue: "2026-01-06",
    Wed: "2026-01-07",
    Thu: "2026-01-08",
    Fri: "2026-01-09",
    Sat: "2026-01-10",
  };
  const ymd = base[weekdayEn];
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${ymd}T${hh}:${mm}:00+03:00`);
}

describe("getContextualFlow", () => {
  test("breakfast 9 AM to 12 PM", () => {
    const flow = getContextualFlow(riyadhDate("Wed", 10, 30));
    expect(flow.primary).toBe("breakfast");
    expect(flow.categories).toEqual(expect.arrayContaining(["breakfast", "drinks", "desserts"]));
  });

  test("brunch on Friday and Saturday 12 PM to 5 PM", () => {
    expect(getContextualFlow(riyadhDate("Fri", 14)).primary).toBe("brunch");
    expect(getContextualFlow(riyadhDate("Sat", 13)).primary).toBe("brunch");
  });

  test("daytime on Sun–Thu 12 PM to 5 PM (not brunch Wed/Thu)", () => {
    expect(getContextualFlow(riyadhDate("Sun", 14)).primary).toBe("daytime");
    expect(getContextualFlow(riyadhDate("Mon", 15)).primary).toBe("daytime");
    expect(getContextualFlow(riyadhDate("Wed", 14)).primary).toBe("daytime");
    expect(getContextualFlow(riyadhDate("Thu", 16)).primary).toBe("daytime");
  });

  test("evening menu 5 PM to 11:30 PM", () => {
    expect(getContextualFlow(riyadhDate("Fri", 18)).primary).toBe("evening");
    expect(getContextualFlow(riyadhDate("Wed", 23)).primary).toBe("evening");
  });

  test("drinks and desserts always included in active flow", () => {
    const flow = getContextualFlow(riyadhDate("Thu", 14));
    expect(flow.categories).toEqual(expect.arrayContaining(["drinks", "desserts"]));
  });
});
