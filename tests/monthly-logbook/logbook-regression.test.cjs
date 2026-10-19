const { strict: assert } = require("node:assert");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const parserSource = fs.readFileSync(path.join(__dirname, "../../supabase/functions/_shared/vaultMonthlyLogbookWorkbook.js"), "utf8")
  .replaceAll("export function ", "function ");
const { parseMonthlyLogbookSheets, mergeMonthlyLogbookFacts } = new Function(
  parserSource + "; return { parseMonthlyLogbookSheets, mergeMonthlyLogbookFacts };",
)();

function buildSheet(day) {
  const sheet = { "!ref": "A1:G36" };
  const set = (address, value) => { sheet[address] = { v: value, t: typeof value === "number" ? "n" : "s" }; };
  set("F2", "DATE");
  set("G2", 46309 + day - 14); // Excel serial date: 14 Oct 2026 + offset
  for (const [row, labels] of [
    [4, ["MOD RESTAURANT", "Raffi", "MOD RESTAURANT", "Marwan"]],
    [5, ["CHEF ON DUTY", "Taleb", "CHEF ON DUTY", "Charles"]],
    [6, ["MOD BAR", "Dexter", "MOD BAR", "Saidul"]],
  ]) {
    ["A", "C", "E", "G"].forEach((column, index) => set(column + row, labels[index]));
  }
  for (const [address, value] of Object.entries({
    A8: "BREAKFAST", A9: "• Morning note", A14: "LUNCH",
    A15: "• Lunch complaint", A19: "DINNER", A20: "C",
    A21: "• Dinner incident", A26: "RECEPTION – HOSTESS",
    A32: "GOOGLE REVIEWS", A36: "• Personalised Service",
  })) set(address, value);
  ["Shift", "Reservations", "Covers", "Walk-ins", "No-shows", "Cancellations"]
    .forEach((value, index) => set("ABCDEF"[index] + "27", value));
  for (const [row, name, value] of [
    [28, "Breakfast", 2], [29, "Lunch", 3], [30, "Dinner", 4], [31, "Total", 9],
  ]) {
    set("A" + row, name);
    for (const col of "BCDEF") set(col + row, value);
  }
  ["5 Star", "4 Star", "3 Star", "2 Star", "1 Star"]
    .forEach((value, index) => set("ABCDE"[index] + "33", value));
  for (const col of "ABCDE") set(col + "34", 0);
  return sheet;
}

test("monthly logbook: October 15–18 narratives, shift personnel, reception and reviews", () => {
  const workbook = { SheetNames: [], Sheets: {} };
  for (let day = 15; day <= 19; day++) {
    const name = day + " Oct 2026";
    workbook.SheetNames.push(name);
    workbook.Sheets[name] = buildSheet(day);
  }
  const parsed = parseMonthlyLogbookSheets(workbook, {
    branchId: "khobar", filename: "Logbook October Nac Khobar.xlsm",
    publishThrough: "2026-10-18",
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.sheets.map((row) => row.status),
    ["publish", "publish", "publish", "publish", "publication_cutoff"]);
  for (let day = 15; day <= 18; day++) {
    const date = "2026-10-" + day;
    const facts = parsed.facts.filter((fact) => fact.period_end === date);
    assert.equal(facts.length, 20);
    for (const key of ["breakfast_notes", "lunch_notes", "dinner_notes", "training_notes",
      "lunch_mod", "dinner_mod", "chef_on_duty", "bar_mod", "covers", "google_review_5"]) {
      assert.ok(facts.some((fact) => fact.metric_key === key), key + " absent " + date);
    }
    assert.equal(facts.find((fact) => fact.metric_key === "dinner_notes").dimensions.text_value,
      "• Dinner incident");
    assert.equal(facts.find((fact) => fact.metric_key === "covers").metric_value, 9);
    assert.equal(facts.filter((fact) => fact.metric_key === "chef_on_duty").length, 2);
    assert.equal(new Set(facts.map((fact) => fact.source_row_ref)).size, facts.length);
  }
  assert.ok(!parsed.facts.some((fact) => fact.period_end === "2026-10-19"));
});

test("date-scoped replacement retains historical dates and excludes unpublished dates", () => {
  const existing = ["2026-10-01", "2026-10-14", "2026-10-15", "2026-10-19"]
    .map((date) => ({ period_end: date, metric_key: "covers" }));
  const parsed = {
    sheets: [{ businessDate: "2026-10-15", publish: true },
      { businessDate: "2026-10-19", publish: false }],
    facts: [{ period_end: "2026-10-15", metric_key: "breakfast_notes" }],
  };
  const merged = mergeMonthlyLogbookFacts(existing, parsed);
  assert.equal(merged.length, 4);
  assert.deepEqual(merged.map((row) => row.period_end).sort(),
    ["2026-10-01", "2026-10-14", "2026-10-15", "2026-10-19"]);
  assert.equal(merged.find((row) => row.period_end === "2026-10-15").metric_key, "breakfast_notes");
});
