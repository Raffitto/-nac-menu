import { PARSEABLE_REPORT_TYPES } from "./vaultConstants";
import { routeVaultParser } from "./vaultIngestion";

describe("parserRegistryTruth", () => {
  test("every parseable report type has a client parser", () => {
    const missing = PARSEABLE_REPORT_TYPES.filter((type) => !routeVaultParser(type));
    expect(missing).toEqual([]);
  });

  test("types without parsers are not declared parseable", () => {
    expect(PARSEABLE_REPORT_TYPES).not.toContain("breakage_report");
    expect(PARSEABLE_REPORT_TYPES).not.toContain("discount_void_comp");
    expect(PARSEABLE_REPORT_TYPES).not.toContain("guest_feedback");
  });
});
