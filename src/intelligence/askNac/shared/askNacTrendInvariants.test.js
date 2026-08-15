/**
 * Trend robustness: matched comparable days and incomplete-day exclusion.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "../../../..");
const fabricPath = path.join(root, "supabase/functions/_shared/companyIntelligence/index.ts");

function run(body) {
  const script = `
    global.Deno = { env: { get: () => undefined } };
    import(${JSON.stringify(fabricPath)}).then(async (mod) => {
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }).trim());
}

const FACTS = `
  function fact(date, net_sales) {
    return { date, net_sales, covers: 300, orders: 110, avg_spend: net_sales / 300 };
  }
  function rangeFacts(start, days, valueFn) {
    const rows = [];
    for (let i = 0; i < days; i++) {
      const date = mod.addIsoDays(start, i);
      rows.push(fact(date, valueFn(date, i)));
    }
    return rows;
  }
`;

describe("trend invariants", () => {
  test("complete recent 7 vs previous 7 is a clear downward trend", () => {
    const out = run(`
      ${FACTS}
      const history = rangeFacts("2026-08-01", 14, (date, i) => i >= 7 ? 18000 : 22000);
      return mod.computeTrend(history, "net_sales", "2025-04-27", "2026-08-14", null);
    `);
    expect(out.class).toBe("downward");
    expect(out.text).not.toMatch(/provisional/i);
  });

  test("missing Friday does not confidently classify a decline from unmatched structure", () => {
    const out = run(`
      ${FACTS}
      const history = rangeFacts("2026-08-01", 14, (date) => date === "2026-08-14" ? null : (date === "2026-08-07" ? 40000 : 20000))
        .filter((f) => f.net_sales != null);
      return mod.computeTrend(history, "net_sales", "2025-04-27", "2026-08-14", null);
    `);
    expect(out.class).not.toBe("downward");
    expect(String(out.text || "")).toMatch(/provisional|flat|enough completed/i);
  });

  test("current incomplete day is excluded", () => {
    const out = run(`
      ${FACTS}
      const history = [
        ...rangeFacts("2026-08-01", 14, (date, i) => i >= 7 ? 18000 : 22000),
        fact("2026-08-15", 900000),
      ];
      return mod.computeTrend(history, "net_sales", "2025-04-27", "2026-08-15", null);
    `);
    expect(out.class).toBe("downward");
    expect(out.text).not.toMatch(/900,?000/);
  });

  test("mixed noisy direction is not a trend", () => {
    const out = run(`
      ${FACTS}
      const history = rangeFacts("2026-08-01", 14, (date, i) => 20000 + ((i % 2) ? 400 : -400));
      return mod.computeTrend(history, "net_sales", "2025-04-27", "2026-08-14", null);
    `);
    expect(["noisy", "broadly_flat"]).toContain(out.class);
  });

  test("tiny sample is insufficient", () => {
    const out = run(`
      ${FACTS}
      const history = rangeFacts("2026-08-10", 4, () => 20000);
      return mod.computeTrend(history, "net_sales", "2025-04-27", "2026-08-14", null);
    `);
    expect(out.class).toBe("insufficient");
  });
});
