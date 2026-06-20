import { replaceStructuredFactsForFile } from "./vaultStructuredFactsReplace";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../../../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260620180000_ask_nac_structured_facts_atomic_replace.sql"),
  "utf8",
);
const driveHelper = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/vaultDriveIngestion.ts"),
  "utf8",
);
const replaceHelper = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/vaultStructuredFactsReplace.ts"),
  "utf8",
);

describe("replace_ask_nac_file_structured_facts RPC", () => {
  test("inserts new facts before deleting superseded rows", () => {
    expect(migration).toMatch(/with inserted as \(\s*insert into public\.ask_nac_structured_facts/is);
    expect(migration).toMatch(/delete from public\.ask_nac_structured_facts\s+where file_id = p_file_id/s);
    expect(migration.indexOf("insert into public.ask_nac_structured_facts")).toBeLessThan(
      migration.indexOf("delete from public.ask_nac_structured_facts"),
    );
  });

  test("rejects inserted facts with null period_end inside the transaction", () => {
    expect(migration).toMatch(/period_end is null/);
    expect(migration).toMatch(/raise exception 'inserted facts include % rows with null period_end'/);
  });

  test("requires minimum inserted count before delete", () => {
    expect(migration).toMatch(/if v_inserted < p_min_inserted then/);
    expect(migration).toMatch(/raise exception 'inserted fact count % below minimum %'/);
  });

  test("is service-role only", () => {
    expect(migration).toMatch(/security definer/);
    expect(migration).toMatch(/grant execute on function public\.replace_ask_nac_file_structured_facts/);
    expect(migration).toMatch(/to service_role/);
  });
});

describe("replaceStructuredFactsForFile edge helper", () => {
  test("uses RPC and does not delete from Edge client", async () => {
    const rpcCalls = [];
    const admin = {
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: { inserted: 2, deleted: 1 }, error: null };
      },
      from() {
        throw new Error("Edge client must not delete facts directly");
      },
    };

    const result = await replaceStructuredFactsForFile(admin, {
      fileId: "file-1",
      rows: [
        {
          department: "operations",
          report_type: "cash_up",
          sensitivity_level: "internal",
          metric_key: "gross_sales",
          metric_value: 100,
          period_start: "2026-06-17",
          period_end: "2026-06-17",
        },
        {
          department: "operations",
          report_type: "cash_up",
          sensitivity_level: "internal",
          metric_key: "net_sales",
          metric_value: 90,
          period_start: "2026-06-17",
          period_end: "2026-06-17",
        },
      ],
      periodStart: "2026-06-17",
      periodEnd: "2026-06-19",
      minInserted: 2,
    });

    expect(result).toEqual({ inserted: 2, deleted: 1 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("replace_ask_nac_file_structured_facts");
    expect(rpcCalls[0].args.p_file_id).toBe("file-1");
    expect(rpcCalls[0].args.p_min_inserted).toBe(2);
  });

  test("RPC failure surfaces without local delete", async () => {
    const admin = {
      rpc: async () => ({ data: null, error: { message: "inserted fact count 0 below minimum 100" } }),
      from() {
        throw new Error("Edge client must not delete facts directly");
      },
    };

    await expect(
      replaceStructuredFactsForFile(admin, {
        fileId: "file-1",
        rows: [{ department: "operations", report_type: "cash_up", sensitivity_level: "internal", metric_key: "gross_sales", metric_value: 1, period_end: "2026-06-17" }],
        periodStart: "2026-06-17",
        periodEnd: "2026-06-17",
        minInserted: 100,
      }),
    ).rejects.toThrow("inserted fact count 0 below minimum 100");
  });
});

describe("Drive ingestion atomic fact replacement wiring", () => {
  test("persistParsedFacts delegates to replaceStructuredFactsForFile RPC", () => {
    expect(driveHelper).toMatch(/replaceStructuredFactsForFile/);
    expect(driveHelper).not.toMatch(/await admin\.from\("ask_nac_structured_facts"\)\.delete\(\)\.eq\("file_id"/);
    expect(replaceHelper).toMatch(/replace_ask_nac_file_structured_facts/);
  });

  test("cash_up workbook path requires full parsed row count before swap", () => {
    expect(driveHelper).toMatch(/minInserted: rows\.length/);
  });

  test("validation failure throws before persistParsedFacts for cash_up XLSX", () => {
    expect(driveHelper).toMatch(/if \(!validateCashUpWorkbookParse\(parsed\)\)/);
    expect(driveHelper).toMatch(/existing facts preserved/);
  });
});
