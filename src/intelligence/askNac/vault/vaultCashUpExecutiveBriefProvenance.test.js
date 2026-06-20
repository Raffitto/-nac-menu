import { buildCashUpExecutiveBrief } from "./vaultCashUpExecutiveBrief";

const JUNE_17_FACT_ROWS = [
  { metric_key: "gross_sales", metric_value: 20633, period_end: "2026-06-17" },
  { metric_key: "net_sales", metric_value: 17941.73913, period_end: "2026-06-17" },
  { metric_key: "cash_sales", metric_value: 629, period_end: "2026-06-17" },
  { metric_key: "card_sales", metric_value: 19046, period_end: "2026-06-17" },
];

const JUNE_17_COVERAGE = {
  period_end: "2026-06-17",
  readiness_status: "partial",
  source_file: { title: "Cash up 2026.xlsx" },
};

const JUNE_17_INPUT = {
  facts: JUNE_17_FACT_ROWS,
  branchLabel: "Khobar",
  periodLabel: "17 June 2026",
  businessDate: "2026-06-17",
  fileTitle: "Cash up 2026.xlsx",
  vaultSources: [{ title: "Cash up 2026.xlsx", reportType: "cash_up", periodEnd: "2026-06-17" }],
  coverage: [JUNE_17_COVERAGE],
};

function hasFact(facts, metricKey) {
  return (facts || []).some(
    (row) => (row.metricKey || row.metric_key) === metricKey && (row.metricValue ?? row.metric_value) != null,
  );
}

function collectBriefText(brief) {
  return [
    brief.executiveSummary,
    ...(brief.keyFindings || []),
    ...(brief.operationalRisks || []),
    ...(brief.recommendedActions || []),
    ...(brief.dataSources || []),
  ].join("\n");
}

/**
 * Fail when executiveBrief contains D-class unsupported assumptions.
 * Returns violation messages (empty = pass).
 */
export function findExecutiveBriefProvenanceViolations(brief, facts = []) {
  const text = collectBriefText(brief);
  const violations = [];

  const hasDiscounts = hasFact(facts, "discounts");
  const hasVoids = hasFact(facts, "voids");
  const hasTarget = hasFact(facts, "target_sales");
  const hasGuests = hasFact(facts, "guest_count");
  const hasCard = hasFact(facts, "card_sales");
  const hasCash = hasFact(facts, "cash_sales");

  if (/discounts\/voids|difference reflects discounts|reflects discounts\/voids/i.test(text)) {
    if (!hasDiscounts && !hasVoids) {
      violations.push("discounts/voids gap explanation without discounts or voids facts");
    }
  }

  if (/\bbudget\b|\bbelow target\b|\bvs\. budget\b|\btrend vs\. budget\b/i.test(text)) {
    if (!hasTarget) {
      violations.push("budget wording without target_sales fact");
    }
  }

  if (/guest count \d|[\d,]+ guests\b/i.test(text) && !hasGuests) {
    violations.push("guest count value without guest_count fact");
  }

  if (/\b(majority|small share|strong|healthy|dominant)\b/i.test(text)) {
    violations.push("qualitative payment or performance wording without explicit threshold rule");
  }

  if (/Company Knowledge upload/i.test(text)) {
    violations.push("marketing copy in dataSources");
  }

  if (/card\/cash settlement|cash\+card settlement|electronic payments.*settlement/i.test(text) && (hasCard || hasCash)) {
    if (!/\d+\.?\d*%/.test(text)) {
      violations.push("settlement narrative without computed percentage");
    }
  }

  return violations;
}

describe("buildCashUpExecutiveBrief provenance hardening", () => {
  test("June 17 brief has no provenance violations", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);
    expect(findExecutiveBriefProvenanceViolations(brief, JUNE_17_FACT_ROWS)).toEqual([]);
  });

  test("does not attribute gross-net gap to discounts/voids without those facts", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);
    const grossNetLine = brief.keyFindings.find((line) => /Gross sales were/i.test(line));

    expect(grossNetLine).toBe(
      "Gross sales were 20,633 SAR and net sales were 17,941.739 SAR.",
    );
    expect(grossNetLine).not.toMatch(/discounts|voids/i);
  });

  test("mentions recorded discounts/voids only when facts exist", () => {
    const brief = buildCashUpExecutiveBrief({
      ...JUNE_17_INPUT,
      facts: [
        ...JUNE_17_FACT_ROWS,
        { metric_key: "discounts", metric_value: 890, period_end: "2026-06-17" },
        { metric_key: "voids", metric_value: 120, period_end: "2026-06-17" },
      ],
    });

    const grossNetLine = brief.keyFindings.find((line) => /Gross sales were/i.test(line));
    expect(grossNetLine).toMatch(/Recorded discounts: 890 SAR/);
    expect(grossNetLine).toMatch(/Recorded voids: 120 SAR/);
    expect(findExecutiveBriefProvenanceViolations(brief, [
      ...JUNE_17_FACT_ROWS,
      { metric_key: "discounts", metric_value: 890 },
      { metric_key: "voids", metric_value: 120 },
    ])).toEqual([]);
  });

  test("returns zero recommended actions when only settlement facts exist", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);
    expect(brief.recommendedActions).toEqual([]);
  });

  test("allows budget action only when target_sales exists", () => {
    const brief = buildCashUpExecutiveBrief({
      ...JUNE_17_INPUT,
      facts: [
        ...JUNE_17_FACT_ROWS,
        { metric_key: "target_sales", metric_value: 42000, period_end: "2026-06-17" },
      ],
    });

    expect(brief.recommendedActions.some((line) => /daypart|staffing|budget/i.test(line))).toBe(true);
    expect(findExecutiveBriefProvenanceViolations(brief, [
      ...JUNE_17_FACT_ROWS,
      { metric_key: "target_sales", metric_value: 42000 },
    ])).toEqual([]);
  });

  test("uses computed electronic payment settlement percentage", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);

    expect(brief.executiveSummary).toMatch(
      /Electronic payments represented 96\.8% of recorded card\/cash settlement\./,
    );
    expect(brief.keyFindings.some((line) =>
      /electronic payments represented 96\.8% of recorded card\/cash settlement/i.test(line),
    )).toBe(true);
    expect(brief.executiveSummary).not.toMatch(/majority|small share/i);
  });

  test("data sources contain only file, date, and report type", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);

    expect(brief.dataSources).toEqual([
      "Cash up 2026.xlsx · 2026-06-17 · cash_up",
    ]);
    expect(brief.dataSources.join(" ")).not.toMatch(/Company Knowledge upload|business date/i);
  });

  test("June 17 hardened sample matches expected provenance-safe output", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);

    expect(brief.executiveSummary).toBe(
      "Khobar cash-up for 2026-06-17 shows net sales of 17,941.739 SAR (gross 20,633 SAR). Electronic payments represented 96.8% of recorded card/cash settlement.",
    );
    expect(brief.keyFindings).toEqual([
      "Electronic payments 19,046 SAR and cash 629 SAR — electronic payments represented 96.8% of recorded card/cash settlement.",
      "Net sales 17,941.739 SAR for Khobar on 17 June 2026.",
      "Gross sales were 20,633 SAR and net sales were 17,941.739 SAR.",
    ]);
    expect(brief.operationalRisks).toEqual([
      "Coverage marked partial — treat as uploaded-file snapshot, not final close.",
      "Missing parsed fields: guest count, average spend per guest.",
    ]);
    expect(brief.recommendedActions).toEqual([]);
    expect(brief.dataSources).toEqual(["Cash up 2026.xlsx · 2026-06-17 · cash_up"]);
  });
});

describe("buildCashUpExecutiveBrief provenance sentence classes", () => {
  test("every sentence is A, B, or C — no D violations", () => {
    const brief = buildCashUpExecutiveBrief(JUNE_17_INPUT);
    const violations = findExecutiveBriefProvenanceViolations(brief, JUNE_17_FACT_ROWS);

    expect(violations).toEqual([]);
  });
});
