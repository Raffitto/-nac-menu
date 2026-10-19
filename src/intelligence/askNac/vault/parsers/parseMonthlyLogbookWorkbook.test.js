import * as XLSX from "xlsx";
import {
  mergeMonthlyLogbookFacts,
  parseMonthlyLogbookSheets,
  parseWorksheetBusinessDate,
  summarizeMonthlyLogbookRun,
} from "./parseMonthlyLogbookWorkbook";

function sheet(rows, formulas = {}) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  for (const [address, cell] of Object.entries(formulas)) worksheet[address] = cell;
  return worksheet;
}

function workbook(sheets) {
  const book = XLSX.utils.book_new();
  for (const [name, worksheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, worksheet, name);
  return book;
}

function daySheet({ date = "15 Oct 2026", notes = "Lunch was steady.", reviews = 2, unresolvedTotal = false, mismatch = false } = {}) {
  const rows = [
    ["Business date", date],
    ["Day of week", "Thursday"],
    ["Lunch restaurant manager", "Rana"],
    ["Dinner restaurant manager", "Fady"],
    ["Chef on duty", "Marco"],
    ["Bar manager on duty", "Ali"],
    ["Breakfast notes", notes],
    ["Lunch notes", "Terrace was full."],
    ["Dinner notes", "Two VIP tables."],
    ["Guest complaints", "One delayed main."],
    ["Operational incidents", "POS restarted once."],
    ["Staff performance observations", "Host desk recovered."],
    ["Handover information", "86 the seabass."],
    ["Training notes", "New host on covers."],
    ["", "Reservations", "Covers", "Walk-ins", "No-shows", "Cancellations"],
    ["Breakfast", 4, 10, 2, 0, 1],
    ["Lunch", 6, 20, 3, 1, 0],
    ["Dinner", 5, 12, 1, 0, 0],
    ["Total", 15, 42, 6, 1, 1],
    ["5 star", reviews],
    ["4 star", 0],
  ];
  const formulas = {};
  if (unresolvedTotal) {
    formulas.B19 = { t: "n", f: "'[Reception.xlsx]Oct'!B12" };
    rows[18][1] = "";
  }
  if (mismatch) rows[18][1] = 99;
  return sheet(rows, formulas);
}

const context = {
  branchId: "khobar",
  fileId: "file-oct",
  workbookId: "drive-oct",
  filename: "Logbook October Nac Khobar.xlsm",
};

describe("monthly logbook workbook", () => {
  test("parses a worksheet date without hardcoding a month", () => {
    expect(parseWorksheetBusinessDate("15 Oct 2026")).toBe("2026-10-15");
    expect(parseWorksheetBusinessDate("01 Nov 2026")).toBe("2026-11-01");
    expect(parseWorksheetBusinessDate("TEMPLATE")).toBeNull();
    expect(parseWorksheetBusinessDate("31 Feb 2026")).toBeNull();
  });

  test("publishes complete days, skips TEMPLATE and an already published DOCX day", () => {
    const book = workbook({
      TEMPLATE: sheet([["Template", "do not publish"]]),
      "14 Oct 2026": daySheet(),
      "15 Oct 2026": daySheet(),
      "16 Oct 2026": daySheet({ date: "16 Oct 2026", notes: "Breakfast quiet." }),
      "17 Oct 2026": daySheet({ date: "17 Oct 2026", notes: "Lunch event." }),
      "18 Oct 2026": sheet([["Business date", "18 Oct 2026"], ["Breakfast notes", ""]]),
    });
    const parsed = parseMonthlyLogbookSheets(book, {
      ...context,
      occupiedDates: ["2026-10-14"],
    });

    expect(parsed.sheets.find((item) => item.name === "TEMPLATE").status).toBe("ignored");
    expect(parsed.sheets.find((item) => item.businessDate === "2026-10-14").status).toBe("skipped_historical");
    expect(parsed.facts.some((fact) => fact.period_end === "2026-10-14")).toBe(false);
    for (const date of ["2026-10-15", "2026-10-16", "2026-10-17"]) {
      expect(parsed.sheets.find((item) => item.businessDate === date).publish).toBe(true);
    }
    const day = parsed.facts.filter((fact) => fact.period_end === "2026-10-15");
    expect(day.find((fact) => fact.metric_key === "covers").metric_value).toBe(42);
    expect(day.find((fact) => fact.metric_key === "no_shows").metric_value).toBe(1);
    expect(day.find((fact) => fact.metric_key === "complaints").dimensions.text_value).toMatch(/delayed main/);
    expect(day.find((fact) => fact.metric_key === "google_review_4").metric_value).toBe(0);
    expect(day.find((fact) => fact.metric_key === "google_review_5").metric_value).toBe(2);
    expect(parsed.sheets.find((item) => item.businessDate === "2026-10-18").status).toBe("awaiting_completion");
    expect(parsed.facts.some((fact) => fact.period_end === "2026-10-18")).toBe(false);
    expect(summarizeMonthlyLogbookRun(parsed.sheets).state).toBe("partial");
  });

  test("does not invent a total when the formula result is missing", () => {
    const book = workbook({ "15 Oct 2026": daySheet({ notes: "", unresolvedTotal: true }) });
    const parsed = parseMonthlyLogbookSheets(book, context);
    const sheetResult = parsed.sheets[0];
    expect(sheetResult.status).toBe("formula_unresolved");
    expect(sheetResult.dependencies[0].formula).toMatch(/Reception.xlsx/);
    expect(parsed.facts).toHaveLength(0);
  });

  test("does not publish a daily total that disagrees with the shifts", () => {
    const book = workbook({ "15 Oct 2026": daySheet({ mismatch: true }) });
    const parsed = parseMonthlyLogbookSheets(book, context);
    expect(parsed.sheets[0].status).not.toBe("publish");
    expect(parsed.sheets[0].warnings[0]).toMatch(/reservations/);
    expect(parsed.facts).toHaveLength(0);
  });

  test("detects a changed worksheet and leaves an unchanged day in place", () => {
    const book = workbook({
      "15 Oct 2026": daySheet(),
      "16 Oct 2026": daySheet({ date: "16 Oct 2026", notes: "Changed handover." }),
    });
    const first = parseMonthlyLogbookSheets(book, context);
    const fingerprints = Object.fromEntries(first.sheets.map((item) => [item.businessDate, item.fingerprint]));
    const second = parseMonthlyLogbookSheets(book, { ...context, previousFingerprints: fingerprints });
    expect(second.sheets.every((item) => item.status === "unchanged")).toBe(true);
    expect(second.facts).toHaveLength(0);

    const changed = workbook({
      "15 Oct 2026": daySheet(),
      "16 Oct 2026": daySheet({ date: "16 Oct 2026", notes: "Corrected complaint." }),
    });
    const third = parseMonthlyLogbookSheets(changed, { ...context, previousFingerprints: fingerprints });
    expect(third.sheets.find((item) => item.businessDate === "2026-10-15").status).toBe("unchanged");
    expect(third.sheets.find((item) => item.businessDate === "2026-10-16").publish).toBe(true);
    const merged = mergeMonthlyLogbookFacts(
      first.facts.filter((fact) => fact.period_end === "2026-10-15"),
      third,
    );
    expect(merged.filter((fact) => fact.period_end === "2026-10-15").length).toBeGreaterThan(0);
    expect(merged.filter((fact) => fact.period_end === "2026-10-16").length).toBe(third.facts.length);
    const kept = mergeMonthlyLogbookFacts(
      [{ period_end: "2026-10-18", metric_key: "covers", metric_value: 10 }],
      { sheets: [{ businessDate: "2026-10-18", status: "awaiting_completion", publish: false }], facts: [] },
    );
    expect(kept).toHaveLength(1);
  });

  test("refuses a workbook whose filename branch differs from the folder", () => {
    const book = workbook({ "15 Oct 2026": daySheet() });
    const parsed = parseMonthlyLogbookSheets(book, { ...context, branchId: "riyadh" });
    expect(parsed.ok).toBe(false);
    expect(parsed.facts).toHaveLength(0);
  });

  test("reads an xlsx workbook with the same worksheet rules", () => {
    const book = workbook({
      TEMPLATE: sheet([["blank"]]),
      "01 Nov 2026": daySheet({ date: "1 Nov 2026", notes: "November opened." }),
    });
    const parsed = parseMonthlyLogbookSheets(book, {
      ...context,
      filename: "Logbook November Nac Khobar.xlsx",
    });
    expect(parsed.facts.some((fact) => fact.period_end === "2026-11-01")).toBe(true);
    expect(parsed.macrosExecuted).toBe(false);
  });

  test("preserves October 1-14 when the workbook contains those dates", () => {
    const existing = Array.from({ length: 14 }, (_, index) => ({
      period_end: `2026-10-${String(index + 1).padStart(2, "0")}`,
      metric_key: "covers",
      metric_value: 100 + index,
      file_id: "docx-logbook",
    }));
    const book = workbook({
      "14 Oct 2026": daySheet({ date: "14 Oct 2026" }),
      "15 Oct 2026": daySheet({ date: "15 Oct 2026" }),
    });
    const parsed = parseMonthlyLogbookSheets(book, {
      ...context,
      occupiedDates: existing.map((fact) => fact.period_end),
    });
    const merged = mergeMonthlyLogbookFacts(existing, parsed);
    for (const fact of existing) {
      const kept = merged.find((item) => item.period_end === fact.period_end && item.file_id === "docx-logbook");
      expect(kept.metric_value).toBe(fact.metric_value);
    }
    expect(merged.some((item) => item.period_end === "2026-10-15" && item.metric_key === "covers")).toBe(true);
  });

  test("does not publish a copied worksheet from an internal date", () => {
    const book = workbook({
      "Copy of 18 Oct 2026": daySheet({ date: "19 Oct 2026" }),
    });
    const parsed = parseMonthlyLogbookSheets(book, context);
    expect(parsed.sheets[0].status).toBe("unrecognized");
    expect(parsed.facts).toHaveLength(0);
  });

  test("rejects a sheet whose date cell disagrees with its name", () => {
    const book = workbook({
      "18 Oct 2026": daySheet({ date: "19 Oct 2026" }),
    });
    const parsed = parseMonthlyLogbookSheets(book, context);
    expect(parsed.sheets[0].status).toBe("date_mismatch");
    expect(parsed.facts).toHaveLength(0);
  });

  test("does not treat formula zeros over blank shifts as a completed day", () => {
    const unfinished = sheet([
      ["DATE", "19 Oct 2026"],
      ["Breakfast notes", "Breakfast was quiet."],
      ["", "Reservations", "Covers", "Walk-ins", "No-shows", "Cancellations"],
      ["Breakfast"],
      ["Lunch"],
      ["Dinner"],
      ["Total"],
    ], {
      B7: { t: "n", f: "SUM(B4:B6)", v: 0 },
      C7: { t: "n", f: "SUM(C4:C6)", v: 0 },
      D7: { t: "n", f: "SUM(D4:D6)", v: 0 },
      E7: { t: "n", f: "SUM(E4:E6)", v: 0 },
      F7: { t: "n", f: "SUM(F4:F6)", v: 0 },
    });
    const parsed = parseMonthlyLogbookSheets(workbook({ "19 Oct 2026": unfinished }), context);
    expect(parsed.sheets[0].status).toBe("awaiting_completion");
    expect(parsed.facts).toHaveLength(0);
  });
});
