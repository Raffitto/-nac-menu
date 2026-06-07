import { inferOperationalLinks, summarizeKnowledgeGraphAnswer } from "./knowledgeGraph";

describe("knowledgeGraph", () => {
  test("links sales overview to reception report in same branch and period", () => {
    const links = inferOperationalLinks(
      [
        {
          id: "a",
          report_type: "weekly_sales_overview",
          primary_branch_id: "khobar",
          period_start: "2026-06-01",
          period_end: "2026-06-07",
          status: "active",
        },
        {
          id: "b",
          report_type: "reception_daily_report",
          primary_branch_id: "khobar",
          period_start: "2026-06-01",
          period_end: "2026-06-07",
          status: "active",
        },
      ],
      {},
    );

    expect(links.some((link) => link.link_type === "sales_to_reception")).toBe(true);
    expect(links.some((link) => link.link_type === "same_branch_period")).toBe(true);
  });

  test("summarizes repeated issue links", () => {
    const summary = summarizeKnowledgeGraphAnswer({
      links: [{ link_reason: "Sales linked to reception", confidence: 0.8 }],
      repeatedIssues: [{ branch: "Khobar", terms: ["complaint", "delay"] }],
    });
    expect(summary.headline).toMatch(/Repeated operational issues/i);
  });
});
