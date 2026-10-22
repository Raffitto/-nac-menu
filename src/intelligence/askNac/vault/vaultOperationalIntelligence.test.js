import { buildCrossDocumentOperationalSummary, buildManagementNote } from "./vaultOperationalIntelligence";

describe("operational evidence integrity", () => {
  test("no matches do not imply no incidents or demand reupload", () => {
    const result = buildCrossDocumentOperationalSummary([], "complaints");
    expect(result.managementNote).toMatch(/does not prove/i);
    expect(result.managementNote).not.toMatch(/upload or re-index/i);
  });

  test("documented remediation does not imply confirmed guest satisfaction", () => {
    const note = buildManagementNote("guest complaint", "Kitchen remade the dish.", "complaint");
    expect(note).toMatch(/verify the outcome/i);
    expect(note).not.toMatch(/guest satisfied/i);
  });
});
