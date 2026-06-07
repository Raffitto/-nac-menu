import { parseReceptionDailyReport } from "./parseReceptionDaily";
import { createIntermediate } from "./vaultIntermediate";

const SAMPLE_RECEPTION = [
  ["Reception Daily Report", ""],
  ["Date", "2026-06-02"],
  ["Branch", "Riyadh"],
  ["Reservations", 48],
  ["Covers", 132],
  ["Walk ins", 18],
  ["No shows", 3],
  ["Cancellations", 2],
  ["Final Covers", 147],
  ["Shift", "Dinner"],
];

describe("parseReceptionDailyReport", () => {
  test("maps reception daily metrics", () => {
    const text = SAMPLE_RECEPTION.map((row) => row.join(": ")).join("\n");
    const result = parseReceptionDailyReport(
      createIntermediate({
        fileType: "xlsx",
        extension: "xlsx",
        matrix: SAMPLE_RECEPTION,
        text,
      }),
      {
        fileId: "file-2",
        branchId: "riyadh",
        department: "reception",
        sensitivityLevel: "internal",
        createdBy: "test@nac.com",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.branchId).toBe("riyadh");
    const keys = result.facts.map((f) => f.metric_key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "reservations",
        "covers",
        "walkins",
        "no_shows",
        "cancellations",
        "final_covers",
        "shift",
      ]),
    );
    expect(result.facts.find((f) => f.metric_key === "walkins").metric_value).toBe(18);
  });
});
