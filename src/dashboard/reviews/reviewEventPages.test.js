import { fetchAllReviewEvents } from "./reviewEventPages";
import { buildBranchReviewComparison } from "../utils/reviewEventMetrics";
import { buildReviewBranchComparisonForProfile } from "../../lib/rbacIntelligenceScope";

function clientFor(rows) {
  const calls = [];
  const supabase = {
    from: (table) => {
      expect(table).toBe("review_events");
      let branch = null;
      const query = {
        select: () => query,
        gte: () => query,
        lte: () => query,
        order: () => query,
        eq: (key, value) => {
          expect(key).toBe("branch_id");
          branch = value;
          return query;
        },
        range: (start, end) => {
          calls.push({ start, end, branch });
          const scoped = branch ? rows.filter((row) => row.branch_id === branch) : rows;
          return Promise.resolve({ data: scoped.slice(start, end + 1), error: null });
        },
      };
      return query;
    },
  };
  return { supabase, calls };
}

const range = { sinceIso: "2026-10-01T00:00:00Z", untilIso: "2026-10-30T00:00:00Z" };

it("reads every page beyond 3,000 and counts four branches while excluding only explicit self_test", async () => {
  const ids = ["khobar", "riyadh", "jeddah", "hettin"];
  const rows = Array.from({ length: 3601 }, (_, index) => ({
    id: index,
    branch_id: ids[index % 4],
    employee_name: index === 10 ? "TEST" : `Staff ${index % 4}`,
    event_type: "qr_scan",
    metadata: index % 100 === 0 ? { self_test: true } : {},
  }));
  const { supabase, calls } = clientFor(rows);
  const actual = await fetchAllReviewEvents(supabase, { select: "*", range });
  expect(actual).toHaveLength(3601);
  expect(calls).toHaveLength(8);
  expect(calls[6]).toMatchObject({ start: 3000, end: 3499 });
  const comparison = buildBranchReviewComparison(actual);
  expect(comparison.map((row) => row.branch_id)).toEqual(expect.arrayContaining(ids));
  expect(comparison.reduce((sum, row) => sum + row.qr_scans, 0)).toBe(3564);
  expect(comparison.find((row) => row.branch_id === "jeddah").qr_scans).toBeGreaterThan(0);
});

it.each(["khobar", "riyadh", "jeddah", "hettin"])("restricts %s exports to the assigned branch", async (branch) => {
  const rows = ["khobar", "riyadh", "jeddah", "hettin"].flatMap((id) =>
    Array.from({ length: 1001 }, (_, index) => ({ branch_id: id, event_type: "qr_scan", employee_name: "TEST", metadata: index === 0 ? { self_test: true } : {} })),
  );
  const { supabase, calls } = clientFor(rows);
  const actual = await fetchAllReviewEvents(supabase, { select: "*", range, branch });
  expect(actual).toHaveLength(1001);
  expect(calls.every((call) => call.branch === branch)).toBe(true);
  const comparison = buildReviewBranchComparisonForProfile(
    { authenticated: true, allBranches: false, branchScope: branch },
    buildBranchReviewComparison(actual),
  );
  expect(comparison.map((row) => row.branch_id)).toEqual([branch]);
  expect(comparison[0].qr_scans).toBe(1000);
});

it("fails a page error instead of exporting partial totals", async () => {
  const supabase = {
    from: () => {
      const query = {
        select: () => query, gte: () => query, lte: () => query,
        order: () => query, range: () => Promise.resolve({ data: null, error: new Error("page unavailable") }),
      };
      return query;
    },
  };
  await expect(fetchAllReviewEvents(supabase, { select: "*", range })).rejects.toThrow("page unavailable");
});
