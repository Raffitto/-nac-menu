import { parseDailyLogbookText } from "./parseDailyLogbook";

const SAMPLE_LOGBOOK = `
Branch: Khobar
Date: 2026-06-03
Shift: Lunch
MOD: Sarah
Chef on duty: Marco
Bar MOD: Ali
Complaints: 2 guests waited 20+ minutes for tables.
Operational issues: POS lag during peak hour.
Staff performance notes: Host team recovered well after rush.
Training notes: New host shadowing reservations desk.
Google reviews: 5 star: 4, 4 star: 2, 3 star: 1
`;

describe("parseDailyLogbookText", () => {
  test("extracts logbook fields and google star counts from sample text", () => {
    const result = parseDailyLogbookText(SAMPLE_LOGBOOK, {
      fileId: "file-3",
      branchId: "khobar",
      department: "operations",
      sensitivityLevel: "internal",
      createdBy: "test@nac.com",
    });

    expect(result.ok).toBe(true);
    expect(result.branchId).toBe("khobar");
    expect(result.periodStart).toBe("2026-06-03");

    const keys = result.facts.map((f) => f.metric_key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "shift",
        "mod_on_duty",
        "chef_on_duty",
        "bar_mod",
        "complaints",
        "operational_issues",
        "staff_performance_notes",
        "training_notes",
        "google_review_5",
        "google_review_4",
        "google_review_3",
      ]),
    );

    const complaints = result.facts.find((f) => f.metric_key === "complaints");
    expect(complaints.dimensions.text_value).toMatch(/waited 20/);
    expect(result.facts.find((f) => f.metric_key === "google_review_5").metric_value).toBe(4);
  });

  test("boosts confidence for NAC logbook filename with substantive PDF-style text", () => {
    const blob = `
Guest complaints: Long wait at terrace tables during dinner service.
Dinner operation: Full house; kitchen ran 15 minutes behind on mains.
Google Review: 5 star 3, 4 star 1
`.repeat(8);

    const result = parseDailyLogbookText(
      blob,
      {
        fileId: "file-logbook",
        branchId: "khobar",
        department: "operations",
        reportType: "daily_logbook",
        sensitivityLevel: "internal",
        createdBy: "test@nac.com",
        originalFilename: "14_June_NAC_Khobar_Logbook.docx.pdf",
      },
      null,
    );

    expect(result.ok).toBe(true);
    expect(result.confidenceMeta.publish).toBe(true);
    expect(result.facts.some((f) => f.metric_key === "complaints")).toBe(true);
    expect(result.facts.some((f) => f.metric_key === "dinner_notes")).toBe(true);
  });
});
