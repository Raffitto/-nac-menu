import { pickCanonicalSessionTotal } from "./analyticsUnifiedAdapter";

describe("pickCanonicalSessionTotal today rollup", () => {
  test("keeps the rollup session count when live session analytics is higher", () => {
    const biRaw = {
      data_source: "rollup",
      total_sessions: 15,
      funnel: { qr_scans: 15 },
    };
    const aggregates = {
      total_sessions: 327,
      funnel: { qr_scans: 327 },
    };

    expect(pickCanonicalSessionTotal(biRaw, aggregates, 24)).toBe(15);
    expect(biRaw._sessionSourceWarning || "").not.toMatch(/using live/i);
  });

  test("keeps live BI when it is already ahead of session analytics", () => {
    const biRaw = {
      data_source: "rpc",
      total_sessions: 40,
      funnel: { qr_scans: 40 },
    };
    const aggregates = {
      total_sessions: 12,
      funnel: { qr_scans: 12 },
    };

    expect(pickCanonicalSessionTotal(biRaw, aggregates, 24)).toBe(40);
  });
});
