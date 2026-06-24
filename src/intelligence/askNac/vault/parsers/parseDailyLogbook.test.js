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

  test("derives period from NAC logbook filename when body date is missing", () => {
    const result = parseDailyLogbookText(
      "Complaints: Terrace wait exceeded 25 minutes during dinner rush.",
      {
        fileId: "file-june",
        branchId: "khobar",
        department: "operations",
        reportType: "daily_logbook",
        sensitivityLevel: "internal",
        createdBy: "test@nac.com",
        originalFilename: "11 June NAC Khobar Logbook.docx",
      },
      null,
    );

    expect(result.ok).toBe(true);
    expect(result.periodStart).toBe("2026-06-11");
    expect(result.periodEnd).toBe("2026-06-11");
    expect(result.facts.every((f) => f.period_end === "2026-06-11")).toBe(true);
  });

  test("parses tabular Khobar txt logbook export (May layout)", () => {
    const tabularLogbook = `
Day:
Sunday
Date:
31.05.2026
MOD RESTAURANT
Bashar
MOD RESTAURANT
Fady
CHEF ON DUTY
Taleb
CHEF ON DUTY
Charles
MOD BAR
Hridayl
MOD BAR
Dexter
Breakfast:
* Breakfast operation was very quiet.
* Table 25 refused to pay for pita bread and we remove from the bill
Lunch:
* Table 20 received cajun chicken under cooked we apologize
Dinner:
* Dinner operation was quite busy. Service went very well
Breakfast
11
22
16
2
11
Lunch
27
81
51
9
2
Total
179
530
395
11
61
Google Review
5 Star
6
2 Star
2
1 Star
1
`.trim();

    const result = parseDailyLogbookText(
      tabularLogbook,
      {
        fileId: "file-may",
        branchId: "khobar",
        department: "operations",
        reportType: "daily_logbook",
        sensitivityLevel: "internal",
        createdBy: "test@nac.com",
        originalFilename: "31 May NAC Khobar Logbook.txt",
      },
      null,
    );

    expect(result.ok).toBe(true);
    expect(result.periodStart).toBe("2026-05-31");
    expect(result.confidenceMeta.level).toBe("high");
    expect(result.confidenceMeta.publish).toBe(true);

    const keys = result.facts.map((f) => f.metric_key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "shift",
        "lunch_mod",
        "dinner_mod",
        "chef_on_duty",
        "bar_mod",
        "complaints",
        "dinner_notes",
        "covers",
        "reservations",
        "google_review_5",
        "google_review_2",
        "google_review_1",
      ]),
    );
    expect(result.facts.find((f) => f.metric_key === "covers").metric_value).toBe(530);
  });
});
