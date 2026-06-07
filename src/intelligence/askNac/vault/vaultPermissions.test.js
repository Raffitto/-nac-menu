import { readFileSync } from "fs";
import path from "path";
import {
  filterFactsForVaultRole,
  filterFilesForVaultRole,
  vaultCanReadScope,
  vaultCanUploadBrandWide,
  vaultCanUploadToBranch,
  vaultFactMatchesFileScope,
} from "./vaultAccess";
import { buildStructuredFact } from "./parsers/vaultParseUtils";
import { buildNarrationPayload } from "../shared/openAiNarrator";

const HARDENING_MIGRATION = path.resolve(
  __dirname,
  "../../../../supabase/migrations/20260606200000_ask_nac_vault_permission_hardening.sql",
);

describe("vault permission hardening migration", () => {
  let sql;

  beforeAll(() => {
    sql = readFileSync(HARDENING_MIGRATION, "utf8");
  });

  test("coverage select inherits source file read scope", () => {
    expect(sql).toMatch(/ask_nac_coverage_select[\s\S]*ask_nac_vault_can_read_file\(source_file_id\)/);
  });

  test("brand-wide file insert restricted to admin/marketing", () => {
    expect(sql).toMatch(/coalesce\(brand_wide, false\) = false[\s\S]*ask_nac_vault_is_admin\(\)/);
    expect(sql).toMatch(/ask_nac_vault_role\(\) = 'marketing'/);
  });

  test("storage select follows registry file read scope", () => {
    expect(sql).toMatch(/ask_nac_vault_storage_select[\s\S]*f\.storage_path = name/);
  });

  test("branch_manager default departments include brand", () => {
    expect(sql).toMatch(/when 'branch_manager' then array\[[^\]]*'brand'/);
  });
});

describe("vault branch isolation", () => {
  const khobarInternal = {
    id: "file-khobar",
    primary_branch_id: "khobar",
    brand_wide: false,
    department: "operations",
    sensitivity_level: "internal",
  };
  const riyadhInternal = {
    id: "file-riyadh",
    primary_branch_id: "riyadh",
    brand_wide: false,
    department: "operations",
    sensitivity_level: "internal",
  };

  test("Khobar manager cannot read Riyadh file metadata", () => {
    const visible = filterFilesForVaultRole([khobarInternal, riyadhInternal], {
      vaultRole: "branch_manager",
      primaryBranchId: "khobar",
    });
    expect(visible.map((f) => f.primary_branch_id)).toEqual(["khobar"]);
  });

  test("Riyadh manager cannot read Khobar file metadata", () => {
    const visible = filterFilesForVaultRole([khobarInternal, riyadhInternal], {
      vaultRole: "branch_manager",
      primaryBranchId: "riyadh",
    });
    expect(visible.map((f) => f.primary_branch_id)).toEqual(["riyadh"]);
  });

  test("CEO can read all branch files within sensitivity", () => {
    const visible = filterFilesForVaultRole([khobarInternal, riyadhInternal], {
      vaultRole: "ceo",
      primaryBranchId: null,
    });
    expect(visible).toHaveLength(2);
  });
});

describe("vault sensitivity and department layering", () => {
  test("Khobar manager cannot read finance-sensitive file", () => {
    expect(
      vaultCanReadScope({
        vaultRole: "branch_manager",
        primaryBranchId: "khobar",
        brandWide: false,
        department: "admin",
        sensitivityLevel: "finance",
        userBranchId: "khobar",
      }),
    ).toBe(false);
  });

  test("brand-wide internal SOP visible to branch manager", () => {
    expect(
      vaultCanReadScope({
        vaultRole: "branch_manager",
        primaryBranchId: null,
        brandWide: true,
        department: "brand",
        sensitivityLevel: "internal",
        userBranchId: "khobar",
      }),
    ).toBe(true);
  });

  test("HR-restricted brand-wide file not visible to branch manager", () => {
    expect(
      vaultCanReadScope({
        vaultRole: "branch_manager",
        primaryBranchId: null,
        brandWide: true,
        department: "hr",
        sensitivityLevel: "hr_restricted",
        userBranchId: "khobar",
      }),
    ).toBe(false);
  });

  test("HR role can read HR-restricted department files", () => {
    expect(
      vaultCanReadScope({
        vaultRole: "hr",
        primaryBranchId: null,
        brandWide: true,
        department: "hr",
        sensitivityLevel: "hr_restricted",
        userBranchId: null,
      }),
    ).toBe(true);
  });
});

describe("vault upload permissions", () => {
  test("branch manager cannot upload brand-wide", () => {
    expect(vaultCanUploadBrandWide("branch_manager")).toBe(false);
    expect(vaultCanUploadBrandWide("ceo")).toBe(true);
    expect(vaultCanUploadBrandWide("marketing")).toBe(true);
  });

  test("branch manager cannot upload to other branches", () => {
    expect(vaultCanUploadToBranch("branch_manager", "riyadh", "khobar")).toBe(false);
    expect(vaultCanUploadToBranch("branch_manager", "khobar", "khobar")).toBe(true);
  });
});

describe("vault fact scope inheritance", () => {
  const file = {
    id: "file-1",
    primary_branch_id: "khobar",
    brand_wide: false,
    department: "admin",
    sensitivity_level: "management",
  };

  test("structured facts inherit file scope fields", () => {
    const fact = buildStructuredFact({
      fileId: file.id,
      branchId: file.primary_branch_id,
      brandWide: file.brand_wide,
      department: file.department,
      reportType: "cash_up",
      sensitivityLevel: file.sensitivity_level,
      metricKey: "net_sales",
      metricValue: 1000,
      periodStart: "2026-06-05",
      periodEnd: "2026-06-05",
      createdBy: "fady@nac.com",
    });
    expect(vaultFactMatchesFileScope(fact, file)).toBe(true);
  });

  test("Ask NAC fact filter excludes unauthorized branch rows", () => {
    const khobarFact = {
      file_id: "file-khobar",
      branch_id: "khobar",
      brand_wide: false,
      department: "operations",
      sensitivity_level: "internal",
    };
    const riyadhFact = {
      file_id: "file-riyadh",
      branch_id: "riyadh",
      brand_wide: false,
      department: "operations",
      sensitivity_level: "internal",
    };
    const files = [
      { id: "file-khobar", primary_branch_id: "khobar", brand_wide: false, department: "operations", sensitivity_level: "internal" },
      { id: "file-riyadh", primary_branch_id: "riyadh", brand_wide: false, department: "operations", sensitivity_level: "internal" },
    ];
    const visible = filterFactsForVaultRole([khobarFact, riyadhFact], files, {
      vaultRole: "branch_manager",
      primaryBranchId: "khobar",
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].branch_id).toBe("khobar");
  });
});

describe("Ask NAC OpenAI narration input boundary", () => {
  test("narration payload only includes provided authorized facts", () => {
    const payload = buildNarrationPayload(
      {
        answerType: "metric",
        title: "Cash-up",
        directAnswer: "Net sales 18,500 SAR.",
        keyMetrics: [{ label: "Net sales", value: 18500, unit: "SAR" }],
        insights: [],
        recommendations: [],
        sources: [{ name: "ask_nac_structured_facts", detail: "RLS-filtered" }],
        warnings: [],
        missingData: [],
        vaultSources: [{ fileId: "file-1", title: "Khobar Cash Up" }],
      },
      {
        question: "What were sales on 5 June?",
        intent: "vault_cash_up_summary",
        tool: { facts: [{ metricKey: "net_sales", metricValue: 18500 }] },
      },
    );
    expect(payload.toolFacts.facts[0].metricValue).toBe(18500);
    expect(payload.deterministicAnswer.keyMetrics[0].value).toBe(18500);
    expect(Object.keys(payload)).not.toContain("serviceRole");
  });
});

describe("Ask NAC vault query tools use RLS client (static)", () => {
  test("vaultQueryTools has no service role bypass", () => {
    const source = readFileSync(path.resolve(__dirname, "./vaultQueryTools.js"), "utf8");
    expect(source).not.toMatch(/service_role/);
    expect(source).toMatch(/RLS/);
  });

  test("Edge vault tools use SupabaseClient parameter (JWT-scoped caller)", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../supabase/functions/_shared/askNacVaultTools.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/service_role/);
    expect(source).toMatch(/SupabaseClient/);
  });

  test("Edge ask-nac handler uses user JWT client", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../supabase/functions/ask-nac/index.ts"),
      "utf8",
    );
    expect(source).toMatch(/Authorization: authHeader/);
    expect(source).not.toMatch(/SERVICE_ROLE/);
  });
});
