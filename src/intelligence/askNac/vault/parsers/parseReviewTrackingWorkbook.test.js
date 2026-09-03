import {
  isReviewTrackingWorkbookName,
  parseReviewTrackingWorkbook,
} from "./parseReviewTrackingWorkbook";

function septemberSheet() {
  return [
    ["Google review tracking"],
    ["Month: September 2026", "2026-09-01", "2026-09-02", "Total"],
    ["Boyboy", 1, null, 1],
    ["Lyn", 2, null, 2],
    ["Ronald", 2, 1, 3],
    ["Saiful", null, 1, 1],
    ["Kaium", 3, 3, 6],
    ["TOTAL", 8, 5, 13],
  ];
}

describe("parseReviewTrackingWorkbook", () => {
  test("identifies the Drive workbook name and ignores reception daily files", () => {
    expect(isReviewTrackingWorkbookName(" 2026 review tracking.xlsx")).toBe(true);
    expect(isReviewTrackingWorkbookName("2026 Reception daily report & Google reviews.xlsx")).toBe(false);
  });

  test("reads monthly staff × date cells and maps Kaium to Kayum", () => {
    const parsed = parseReviewTrackingWorkbook({ September: septemberSheet() });
    expect(parsed.ok).toBe(true);
    const byDay = {};
    parsed.entries.forEach((e) => {
      if (!byDay[e.review_date]) byDay[e.review_date] = {};
      byDay[e.review_date][e.staff_name] = e.review_count;
    });
    expect(byDay["2026-09-01"]).toEqual({
      Boyboy: 1,
      Lyn: 2,
      Ronald: 2,
      Kayum: 3,
    });
    expect(byDay["2026-09-02"]).toEqual({
      Ronald: 1,
      Saiful: 1,
      Kayum: 3,
    });
    expect(parsed.entries.some((e) => e.staff_name === "TOTAL")).toBe(false);
  });
});
