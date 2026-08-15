/**
 * Tiny parity check: client vaultPeriodParser.js vs Deno shared vaultPeriodParser.ts
 * for the temporal behaviors synced on 10 Aug 2026.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  parseVaultPeriodFromQuestion,
  parseVaultComparePeriodsFromQuestion,
  listPeriodDates,
  isVaultCashUpAnalyticsPeriod,
} from "./vaultPeriodParser";

const REF = new Date("2026-06-20T12:00:00");
const EDGE_PARSER = path.resolve(
  __dirname,
  "../../../../supabase/functions/_shared/vaultPeriodParser.ts",
);

describe("Ask NAC edge period parser parity", () => {
  test("edge source exports the synced temporal helpers", () => {
    const src = fs.readFileSync(EDGE_PARSER, "utf8");
    expect(src).toMatch(/export function listPeriodDates/);
    expect(src).toMatch(/last\/past N days/);
    expect(src).toMatch(/\(last\|previous\)\\s\+month\\b/);
    expect(src).toMatch(/\\btoday\\b/);
    expect(src).toMatch(/compareN/);
    expect(src).toMatch(/isRollingDayPeriodType/);
    expect(src).toMatch(/expectedDayCount/);
  });

  test("client and edge resolve the same temporal windows", () => {
    const script = `
      import * as edge from ${JSON.stringify(EDGE_PARSER)};
      const REF = new Date("2026-06-20T12:00:00");
      const cases = [
        ["sales last 10 days", "period"],
        ["sales last 7 days", "period"],
        ["sales yesterday", "period"],
        ["sales today", "period"],
        ["guests this month", "period"],
        ["sales last month", "period"],
        ["sales ytd", "period"],
        ["compare last 10 days vs previous 10 days", "compare"],
      ];
      const out = {};
      for (const [q, kind] of cases) {
        if (kind === "compare") {
          const c = edge.parseVaultComparePeriodsFromQuestion(q, REF);
          out[q] = {
            current: c?.current && {
              startDate: c.current.startDate,
              endDate: c.current.endDate,
              periodType: c.current.periodType,
              expectedDayCount: c.current.expectedDayCount ?? null,
            },
            previous: c?.previous && {
              startDate: c.previous.startDate,
              endDate: c.previous.endDate,
              periodType: c.previous.periodType,
              expectedDayCount: c.previous.expectedDayCount ?? null,
            },
          };
        } else {
          const p = edge.parseVaultPeriodFromQuestion(q, REF);
          out[q] = p && {
            startDate: p.startDate,
            endDate: p.endDate,
            periodType: p.periodType,
            expectedDayCount: p.expectedDayCount ?? null,
            dateCount: edge.listPeriodDates(p).length,
            analytics: edge.isVaultCashUpAnalyticsPeriod(p),
          };
        }
      }
      console.log(JSON.stringify(out));
    `;

    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const edgeOut = JSON.parse(result.stdout.trim().split("\n").filter(Boolean).pop());

    const last10 = parseVaultPeriodFromQuestion("sales last 10 days", REF);
    expect(edgeOut["sales last 10 days"]).toEqual({
      startDate: last10.startDate,
      endDate: last10.endDate,
      periodType: last10.periodType,
      expectedDayCount: last10.expectedDayCount,
      dateCount: listPeriodDates(last10).length,
      analytics: isVaultCashUpAnalyticsPeriod(last10),
    });
    expect(listPeriodDates(last10)).toHaveLength(10);

    const last7 = parseVaultPeriodFromQuestion("sales last 7 days", REF);
    expect(edgeOut["sales last 7 days"].startDate).toBe(last7.startDate);
    expect(edgeOut["sales last 7 days"].endDate).toBe(last7.endDate);

    expect(edgeOut["sales yesterday"].startDate).toBe(
      parseVaultPeriodFromQuestion("sales yesterday", REF).startDate,
    );
    expect(edgeOut["sales today"].startDate).toBe(
      parseVaultPeriodFromQuestion("sales today", REF).startDate,
    );

    const mtd = parseVaultPeriodFromQuestion("guests this month", REF);
    expect(edgeOut["guests this month"].startDate).toBe(mtd.startDate);
    expect(edgeOut["guests this month"].endDate).toBe(mtd.endDate);

    const lastMonth = parseVaultPeriodFromQuestion("sales last month", REF);
    expect(edgeOut["sales last month"]).toMatchObject({
      startDate: lastMonth.startDate,
      endDate: lastMonth.endDate,
    });

    const ytd = parseVaultPeriodFromQuestion("sales ytd", REF);
    expect(edgeOut["sales ytd"]).toMatchObject({
      startDate: ytd.startDate,
      endDate: ytd.endDate,
      periodType: "year_to_date",
    });

    const compare = parseVaultComparePeriodsFromQuestion(
      "compare last 10 days vs previous 10 days",
      REF,
    );
    expect(edgeOut["compare last 10 days vs previous 10 days"]).toEqual({
      current: {
        startDate: compare.current.startDate,
        endDate: compare.current.endDate,
        periodType: compare.current.periodType,
        expectedDayCount: compare.current.expectedDayCount ?? null,
      },
      previous: {
        startDate: compare.previous.startDate,
        endDate: compare.previous.endDate,
        periodType: compare.previous.periodType,
        expectedDayCount: compare.previous.expectedDayCount ?? null,
      },
    });
    expect(compare.previous.endDate < compare.current.startDate).toBe(true);
  });
});
