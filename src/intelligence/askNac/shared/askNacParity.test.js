import {
  normalizeMtdDiagnostics,
  collectAskNacMetricWarnings,
} from "./mtdDiagnostics";
import {
  mergeMonthToDateHybrid,
} from "../../../lib/mtdHybridMerge";

describe("askNac mtdDiagnostics", () => {
  test("normalizeMtdDiagnostics maps hybrid payload", () => {
    const diag = normalizeMtdDiagnostics(
      {
        source: "hybrid",
        includesCurrentBusinessDay: true,
        partialLive: true,
        warnings: ["Enforced MTD ≥ Today invariant for menu QR / sessions."],
        rollupMenuQr: 30,
        liveTodayMenuQr: 50,
        hybridMenuQr: 50,
        businessDayKey: "2026-06-06",
      },
      "hybrid",
    );
    expect(diag.source).toBe("hybrid");
    expect(diag.partialLive).toBe(true);
    expect(diag.includesCurrentBusinessDay).toBe(true);
    expect(diag.warnings).toHaveLength(1);
  });

  test("normalizeMtdDiagnostics infers live for today RPC", () => {
    const diag = normalizeMtdDiagnostics(null, "rpc");
    expect(diag.source).toBe("live");
    expect(diag.includesCurrentBusinessDay).toBe(true);
  });

  test("collectAskNacMetricWarnings adds hybrid note when partialLive", () => {
    const warnings = collectAskNacMetricWarnings({
      mtdHybrid: normalizeMtdDiagnostics(
        { source: "hybrid", partialLive: true, corrected: true, warnings: [] },
        "hybrid",
      ),
      partial: true,
    });
    expect(warnings.some((w) => w.includes("hybrid"))).toBe(true);
  });

  test("collectAskNacMetricWarnings flags rollup-only MTD", () => {
    const warnings = collectAskNacMetricWarnings({
      partial: true,
      mtdHybrid: normalizeMtdDiagnostics(null, "rollup"),
      note: "Month-to-date uses rollup only — live Today slice unavailable.",
    });
    expect(warnings.some((w) => w.includes("rollup only"))).toBe(true);
  });
});

describe("askNac edge parity merge scenarios", () => {
  test("stale rollup 30 + live today 50 → hybrid at least 50", () => {
    const result = mergeMonthToDateHybrid({
      rollupPayload: { funnel: { qr_scans: 30 } },
      liveTodayPayload: { funnel: { qr_scans: 50 } },
    });
    expect(result.hybridMenuQr).toBeGreaterThanOrEqual(50);
  });

  test("rollup includes today 50 in 150 — no double count to 200", () => {
    const result = mergeMonthToDateHybrid({
      rollupPayload: { funnel: { qr_scans: 150 }, today_qr_sessions: 50 },
      liveTodayPayload: { funnel: { qr_scans: 50 } },
    });
    expect(result.hybridMenuQr).toBe(150);
  });
});
