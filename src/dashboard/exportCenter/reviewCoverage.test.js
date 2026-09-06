import { fetchReviewTrackingCoverage, reviewDatesFromCoverageRpc } from "./reviewCoverage";

describe("review coverage RPC", () => {
  test("maps distinct dates only", () => {
    expect(reviewDatesFromCoverageRpc({
      dates: ["2026-08-01", "2026-08-31T00:00:00", "2026-08-01"],
    })).toEqual(["2026-08-01", "2026-08-31"]);
  });

  test("fetchReviewTrackingCoverage uses the coverage RPC, not staff rows", async () => {
    const supabase = {
      rpc: async (name, args) => {
        expect(name).toBe("get_google_review_tracking_coverage");
        expect(args).toEqual({
          p_branch_id: "khobar",
          p_start_date: "2026-08-01",
          p_end_date: "2026-08-31",
        });
        return {
          data: {
            coverage_start: "2026-08-01",
            coverage_end: "2026-08-31",
            distinct_date_count: 2,
            dates: ["2026-08-01", "2026-08-31"],
          },
          error: null,
        };
      },
    };
    const result = await fetchReviewTrackingCoverage(supabase, {
      branch: "khobar",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(result.error).toBeNull();
    expect(result.reviewDates).toEqual(["2026-08-01", "2026-08-31"]);
  });
});
