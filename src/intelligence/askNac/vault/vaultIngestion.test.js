import { parseVaultStructuredFile } from "./vaultIngestion";
import { filterFilesForVaultRole, vaultCanUploadToBranch } from "./vaultAccess";

describe("vaultAccess listing", () => {
  const khobarFinanceFile = {
    primary_branch_id: "khobar",
    brand_wide: false,
    department: "admin",
    sensitivity_level: "finance",
  };
  const riyadhInternalFile = {
    primary_branch_id: "riyadh",
    brand_wide: false,
    department: "reception",
    sensitivity_level: "internal",
  };

  test("branch manager sees own branch only and not finance sensitivity", () => {
    const visible = filterFilesForVaultRole([khobarFinanceFile, riyadhInternalFile], {
      vaultRole: "branch_manager",
      primaryBranchId: "khobar",
    });
    expect(visible).toHaveLength(0);
  });

  test("ceo sees cross-branch files within sensitivity ceiling", () => {
    const visible = filterFilesForVaultRole([khobarFinanceFile, riyadhInternalFile], {
      vaultRole: "ceo",
      primaryBranchId: null,
    });
    expect(visible).toHaveLength(2);
  });

  test("branch manager cannot upload other branches", () => {
    expect(vaultCanUploadToBranch("branch_manager", "riyadh", "khobar")).toBe(false);
    expect(vaultCanUploadToBranch("branch_manager", "khobar", "khobar")).toBe(true);
  });

  test("ceo can upload brand-wide", () => {
    expect(vaultCanUploadToBranch("ceo", "brand", null)).toBe(true);
  });
});

describe("parseVaultStructuredFile failures", () => {
  test("unsupported report type returns failed parse shape", async () => {
    const file = {
      name: "other.csv",
      text: async () => "a,b\n1,2",
    };
    const result = await parseVaultStructuredFile(file, {
      reportType: "brand_brain_sop",
      fileId: "x",
      branchId: "khobar",
      department: "brand",
      sensitivityLevel: "internal",
      createdBy: "t@nac.com",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No parser for report type/);
  });

  test("unrecognized layout fails parse (failed job path)", async () => {
    const file = {
      name: "weak.csv",
      text: async () => "Unknown,Layout\nfoo,bar",
    };
    const result = await parseVaultStructuredFile(file, {
      reportType: "cash_up",
      fileId: "x",
      branchId: "khobar",
      department: "admin",
      sensitivityLevel: "management",
      createdBy: "t@nac.com",
    });
    expect(result.ok).toBe(false);
    expect(result.publish).toBe(false);
    expect(result.publishedFacts).toEqual([]);
  });
});
