import {
  defaultVaultUploadForm,
  vaultBranchOptionsForProfile,
  VAULT_REPORT_TYPES,
} from "./vaultConstants";

describe("vaultConstants", () => {
  test("branch manager gets single branch upload options", () => {
    const options = vaultBranchOptionsForProfile({
      authenticated: true,
      allBranches: false,
      branchScope: "khobar",
    });
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("khobar");
  });

  test("ceo gets all branch filter plus canonical branches", () => {
    const options = vaultBranchOptionsForProfile({
      authenticated: true,
      allBranches: true,
    });
    expect(options.some((o) => o.value === "all")).toBe(true);
    expect(options.some((o) => o.value === "jeddah")).toBe(true);
  });

  test("default upload form respects branch scope", () => {
    const form = defaultVaultUploadForm({
      allBranches: false,
      branchScope: "riyadh",
    });
    expect(form.branch).toBe("riyadh");
    expect(form.sensitivity).toBe("internal");
  });

  test("report types include approved first types", () => {
    const codes = VAULT_REPORT_TYPES.map((t) => t.value);
    expect(codes).toEqual(
      expect.arrayContaining([
        "cash_up",
        "reception_daily_report",
        "daily_logbook",
        "brand_brain_sop",
        "ccm_reconciliation",
      ]),
    );
  });
});
