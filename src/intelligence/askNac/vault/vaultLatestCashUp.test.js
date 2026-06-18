import {
  CASH_UP_FACTS_QUERY_LIMIT,
  CASH_UP_STRUCTURED_METRIC_KEYS,
} from "./vaultSalesPerformanceIntelligence";
import {
  getLatestVaultCashUpFacts,
  runVaultQueryTool,
} from "./vaultQueryTools";

const STALE_COVERAGE = {
  id: "stale-cov",
  branch_id: "khobar",
  report_type: "cash_up",
  period_start: null,
  period_end: null,
  fact_count: 1,
  readiness_status: "partial",
  last_ingested_at: "2026-06-16T16:07:17.254+00:00",
  source_file_id: "stale-file",
  source_file: {
    id: "stale-file",
    title: "Cash up 2026-2.xlsx",
    original_filename: "Cash up 2026-2.xlsx",
    report_type: "cash_up",
  },
};

const GOOD_COVERAGE = {
  id: "good-cov",
  branch_id: "khobar",
  report_type: "cash_up",
  period_start: "2026-01-01",
  period_end: "2026-06-17",
  fact_count: 4008,
  readiness_status: "partial",
  last_ingested_at: "2026-06-18T17:00:01.59223+00:00",
  source_file_id: "good-file",
  source_file: {
    id: "good-file",
    title: "Cash up 2026.xlsx",
    original_filename: "Cash up 2026.xlsx",
    report_type: "cash_up",
  },
};

const JUNE_17_FACT_ROWS = [
  {
    id: "f-gross",
    file_id: "good-file",
    branch_id: "khobar",
    report_type: "cash_up",
    metric_key: "gross_sales",
    metric_value: 20633,
    metric_unit: null,
    dimensions: {},
    period_start: "2026-06-17",
    period_end: "2026-06-17",
    grain: "daily",
    confidence: 1,
    created_at: "2026-06-18T17:00:01.59223+00:00",
    file: {
      id: "good-file",
      title: "Cash up 2026.xlsx",
      original_filename: "Cash up 2026.xlsx",
    },
  },
  {
    id: "f-net",
    file_id: "good-file",
    branch_id: "khobar",
    report_type: "cash_up",
    metric_key: "net_sales",
    metric_value: 17941.73913,
    metric_unit: null,
    dimensions: {},
    period_start: "2026-06-17",
    period_end: "2026-06-17",
    grain: "daily",
    confidence: 1,
    created_at: "2026-06-18T17:00:01.59223+00:00",
    file: {
      id: "good-file",
      title: "Cash up 2026.xlsx",
      original_filename: "Cash up 2026.xlsx",
    },
  },
  {
    id: "f-cash",
    file_id: "good-file",
    branch_id: "khobar",
    report_type: "cash_up",
    metric_key: "cash_sales",
    metric_value: 629,
    metric_unit: null,
    dimensions: {},
    period_start: "2026-06-17",
    period_end: "2026-06-17",
    grain: "daily",
    confidence: 1,
    created_at: "2026-06-18T17:00:01.59223+00:00",
    file: {
      id: "good-file",
      title: "Cash up 2026.xlsx",
      original_filename: "Cash up 2026.xlsx",
    },
  },
  {
    id: "f-card",
    file_id: "good-file",
    branch_id: "khobar",
    report_type: "cash_up",
    metric_key: "card_sales",
    metric_value: 19046,
    metric_unit: null,
    dimensions: {},
    period_start: "2026-06-17",
    period_end: "2026-06-17",
    grain: "daily",
    confidence: 1,
    created_at: "2026-06-18T17:00:01.59223+00:00",
    file: {
      id: "good-file",
      title: "Cash up 2026.xlsx",
      original_filename: "Cash up 2026.xlsx",
    },
  },
];

function createCashUpSupabaseMock({
  coverageRows = [STALE_COVERAGE, GOOD_COVERAGE],
  businessDate = "2026-06-17",
  factsRows = JUNE_17_FACT_ROWS,
  factsQueryLog = null,
} = {}) {
  return {
    from(table) {
      const state = {
        selects: [],
        filters: {},
        neqs: {},
        nots: [],
        inFilter: null,
        lte: {},
        gte: {},
        orderCol: null,
        orderAsc: true,
        limitN: null,
      };

      const chain = {
        select(cols) {
          state.selects.push(cols);
          return chain;
        },
        eq(col, val) {
          state.filters[col] = val;
          return chain;
        },
        neq(col, val) {
          state.neqs[col] = val;
          return chain;
        },
        not(col, op, val) {
          state.nots.push({ col, op, val });
          return chain;
        },
        in(col, vals) {
          state.inFilter = { col, vals };
          return chain;
        },
        lte(col, val) {
          state.lte[col] = val;
          return chain;
        },
        gte(col, val) {
          state.gte[col] = val;
          return chain;
        },
        order(col, opts = {}) {
          state.orderCol = col;
          state.orderAsc = opts.ascending !== false;
          return chain;
        },
        limit(n) {
          state.limitN = n;
          return chain;
        },
      };

      chain.then = (onFulfilled, onRejected) => {
        if (table === "ask_nac_data_coverage") {
          let rows = coverageRows.filter((row) => {
            if (state.filters.report_type && row.report_type !== state.filters.report_type) return false;
            if (state.filters.branch_id && row.branch_id !== state.filters.branch_id) return false;
            const excludeNullPeriodEnd = state.nots.some(
              (entry) => entry.col === "period_end" && entry.op === "is" && entry.val === null,
            );
            if (excludeNullPeriodEnd && row.period_end == null) return false;
            return true;
          });

          if (state.orderCol) {
            rows = [...rows].sort((a, b) => {
              const av = a[state.orderCol] ?? "";
              const bv = b[state.orderCol] ?? "";
              return state.orderAsc
                ? String(av).localeCompare(String(bv))
                : String(bv).localeCompare(String(av));
            });
          }

          if (state.limitN) rows = rows.slice(0, state.limitN);
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
        }

        if (table === "ask_nac_structured_facts") {
          const isBusinessDateProbe =
            state.selects.some((s) => String(s).includes("period_end"))
            && Object.keys(state.lte).length === 0
            && Object.keys(state.gte).length === 0
            && state.limitN === 1;

          if (isBusinessDateProbe) {
            return Promise.resolve({ data: [{ period_end: businessDate }], error: null }).then(onFulfilled, onRejected);
          }

          if (factsQueryLog) factsQueryLog.push({ ...state });

          return Promise.resolve({ data: factsRows, error: null }).then(onFulfilled, onRejected);
        }

        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      };

      return chain;
    },
  };
}

describe("getLatestVaultCashUpFacts", () => {
  test("stale cash_up coverage row with null period_end does not win", async () => {
    const supabase = createCashUpSupabaseMock();
    const result = await getLatestVaultCashUpFacts(supabase, { filters: { branch: "khobar" } });

    expect(result.coverage[0].fileTitle).toBe("Cash up 2026.xlsx");
    expect(result.coverage[0].sourceFileId).toBe("good-file");
  });

  test("latest cash_up selects Cash up 2026.xlsx over Cash up 2026-2.xlsx", async () => {
    const supabase = createCashUpSupabaseMock();
    const result = await getLatestVaultCashUpFacts(supabase, { filters: { branch: "khobar" } });

    expect(result.vaultSources[0].title).toBe("Cash up 2026.xlsx");
    expect(result.periodLabel).toMatch(/17 June 2026/);
  });

  test("show latest cash up returns 17 June metrics", async () => {
    const factsQueryLog = [];
    const supabase = createCashUpSupabaseMock({ factsQueryLog });
    const result = await getLatestVaultCashUpFacts(supabase, {
      question: "show latest cash up",
      filters: { branch: "khobar", selectedRange: "today" },
    });

    const netSales = result.facts.find((f) => f.metricKey === "net_sales");
    expect(netSales?.metricValue).toBe(17941.73913);

    const grossSales = result.facts.find((f) => f.metricKey === "gross_sales");
    expect(grossSales?.metricValue).toBe(20633);

    expect(factsQueryLog.length).toBe(1);
    expect(factsQueryLog[0].lte.period_start).toBe("2026-06-17");
    expect(factsQueryLog[0].gte.period_end).toBe("2026-06-17");
    expect(factsQueryLog[0].inFilter.col).toBe("metric_key");
    expect(factsQueryLog[0].inFilter.vals).toEqual(CASH_UP_STRUCTURED_METRIC_KEYS);
    expect(factsQueryLog[0].limitN).toBe(CASH_UP_FACTS_QUERY_LIMIT);
  });
});

describe("runVaultQueryTool cash_up dated queries", () => {
  test("net sales yesterday uses vault period date when dashboard range is today", async () => {
    const factsQueryLog = [];
    const supabase = createCashUpSupabaseMock({ factsQueryLog });

    const result = await runVaultQueryTool(supabase, "vault_cash_up_summary", {
      question: "net sales yesterday",
      vaultPeriod: {
        startDate: "2026-06-17",
        endDate: "2026-06-17",
        label: "17 June 2026",
        isSingleDay: true,
      },
      filters: {
        branch: "khobar",
        selectedRange: "today",
        timeRangeHours: 24,
      },
    });

    expect(factsQueryLog.length).toBe(1);
    expect(factsQueryLog[0].lte.period_start).toBe("2026-06-17");
    expect(factsQueryLog[0].gte.period_end).toBe("2026-06-17");
    expect(factsQueryLog[0].inFilter.col).toBe("metric_key");
    expect(factsQueryLog[0].limitN).toBe(CASH_UP_FACTS_QUERY_LIMIT);

    const netSales = result.facts.find((f) => f.metricKey === "net_sales");
    expect(netSales?.metricValue).toBe(17941.73913);
  });
});
