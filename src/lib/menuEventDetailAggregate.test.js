import {
  aggregateMenuEventDetails,
  summarizeMenuEventDetails,
} from "./menuEventDetailAggregate";

function event(overrides) {
  return {
    created_at: "2026-10-14T12:00:00Z",
    branch_id: "khobar",
    session_id: "s1",
    language: "en",
    metadata: {},
    ...overrides,
  };
}

const FIXTURE = [
  event({ event_type: "item_open", item_name_en: "Rigatoni Pink Sauce", session_id: "s1" }),
  event({ event_type: "item_open", item_name_en: "Rigatoni Pink Sauce", session_id: "s2", language: "ar" }),
  event({ event_type: "item_open", item_name_en: "Corn & White Truffle Risotto", session_id: "s1" }),
  event({ event_type: "item_open", item_name_en: "   ", session_id: "s3" }),
  event({ event_type: "category_open", category_id: "evening", session_id: "s1" }),
  event({ event_type: "category_open", category_id: "evening", session_id: "s2" }),
  event({ event_type: "category_open", category_id: "daytime", session_id: "s1" }),
  event({ event_type: "category_open", category_id: "", session_id: "s4" }),
  event({
    event_type: "add_on_click",
    item_name_en: "Rigatoni Pink Sauce",
    add_on_name: "Add Chicken",
    session_id: "s1",
    created_at: "2026-10-14T12:01:00Z",
    metadata: {},
  }),
  event({
    event_type: "add_on_click",
    item_name_en: "Rigatoni Pink Sauce",
    add_on_name: "Add Chicken",
    session_id: "s1",
    created_at: "2026-10-14T12:01:01Z",
    metadata: { source: "add_on_open" },
  }),
  event({
    event_type: "add_on_click",
    item_name_en: "Corn & White Truffle Risotto",
    add_on_name: "Add Prawns",
    session_id: "s2",
    created_at: "2026-10-14T12:05:00Z",
    metadata: { source: "add_on_open" },
  }),
  event({ event_type: "search_used", search_query: "  Prawn ", language: "en", session_id: "s1" }),
  event({ event_type: "search_submit", search_query: "prawn", language: "ar", session_id: "s2" }),
  event({ event_type: "search_used", search_query: " ", session_id: "s3" }),
  event({
    event_type: "time_spent",
    session_id: "s1",
    metadata: { duration_seconds: 100 },
  }),
  event({
    event_type: "time_spent",
    session_id: "s2",
    metadata: { duration_seconds: 5000 },
  }),
  event({
    event_type: "time_spent",
    session_id: "s3",
    metadata: { duration_seconds: 0 },
  }),
  event({
    event_type: "item_open",
    item_name_en: "Riyadh Only",
    branch_id: "riyadh",
    session_id: "r1",
    language: "ar",
  }),
];

describe("menu event detail aggregation", () => {
  const details = aggregateMenuEventDetails(FIXTURE);
  const summary = summarizeMenuEventDetails(details, { branch: "khobar" });

  test("ranks named items and drops blank names", () => {
    expect(summary.top_items.map((row) => [row.name, row.opens])).toEqual([
      ["Rigatoni Pink Sauce", 2],
      ["Corn & White Truffle Risotto", 1],
    ]);
  });

  test("ranks categories from category_open only", () => {
    expect(summary.top_categories.map((row) => [row.id, row.opens])).toEqual([
      ["evening", 2],
      ["daytime", 1],
    ]);
  });

  test("merges search text without inventing a blank query", () => {
    expect(summary.top_searches).toEqual([{ query: "prawn", count: 2 }]);
  });

  test("counts one logical add-on click and keeps a lone historical shadow", () => {
    expect(summary.top_addon_pairs).toEqual([
      { item: "Corn & White Truffle Risotto", addon: "Add Prawns", clicks: 1 },
      { item: "Rigatoni Pink Sauce", addon: "Add Chicken", clicks: 1 },
    ]);
  });

  test("averages positive capped durations and ignores zero", () => {
    expect(summary.avg_time_spent).toBe(Math.round((100 + 1200) / 2));
  });

  test("counts the first language of each Khobar session", () => {
    expect(summary.lang_behavior.en.sessions).toBe(3);
    expect(summary.lang_behavior.ar.sessions).toBe(1);
    expect(summarizeMenuEventDetails(details, { branch: "khobar", language: "ar" }).top_searches)
      .toEqual([{ query: "prawn", count: 1 }]);
  });

  test("does not leak another branch into a branch report", () => {
    expect(summary.top_items.some((row) => row.name === "Riyadh Only")).toBe(false);
    const riyadh = summarizeMenuEventDetails(details, { branch: "riyadh" });
    expect(riyadh.top_items).toEqual([{ name: "Riyadh Only", opens: 1, impressions: 0 }]);
    expect(riyadh.lang_behavior.ar.sessions).toBe(1);
    expect(riyadh.lang_behavior.en.sessions).toBe(0);
  });

  test("is idempotent for the same events", () => {
    expect(aggregateMenuEventDetails(FIXTURE)).toEqual(aggregateMenuEventDetails(FIXTURE));
  });

  test("two real clicks inside the three-second window both count", () => {
    const rows = [
      event({
        event_type: "add_on_click",
        item_name_en: "Rigatoni Pink Sauce",
        add_on_name: "Add Chicken",
        created_at: "2026-10-14T12:00:00.000Z",
      }),
      event({
        event_type: "add_on_click",
        item_name_en: "Rigatoni Pink Sauce",
        add_on_name: "Add Chicken",
        created_at: "2026-10-14T12:00:02.000Z",
      }),
    ];
    const result = summarizeMenuEventDetails(aggregateMenuEventDetails(rows));
    expect(result.top_addon_pairs[0].clicks).toBe(2);
  });

  test("a missing duration is excluded from the average", () => {
    const rows = [
      event({ event_type: "time_spent", metadata: { duration_seconds: 80 } }),
      event({ event_type: "time_spent", session_id: "s2", metadata: {} }),
    ];
    const result = summarizeMenuEventDetails(aggregateMenuEventDetails(rows));
    expect(result.avg_time_spent).toBe(80);
    expect(result.duration_samples).toBe(1);
    expect(result.duration_note).toMatch(/excluded/i);
  });

  test("two real clicks ten seconds apart both count", () => {
    const rows = [
      event({
        event_type: "add_on_click",
        item_name_en: "Rigatoni Pink Sauce",
        add_on_name: "Add Chicken",
        created_at: "2026-10-14T12:00:00Z",
      }),
      event({
        event_type: "add_on_click",
        item_name_en: "Rigatoni Pink Sauce",
        add_on_name: "Add Chicken",
        created_at: "2026-10-14T12:00:10Z",
      }),
    ];
    const result = summarizeMenuEventDetails(aggregateMenuEventDetails(rows));
    expect(result.top_addon_pairs[0].clicks).toBe(2);
  });
});
