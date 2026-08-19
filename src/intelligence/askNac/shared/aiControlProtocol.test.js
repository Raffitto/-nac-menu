/**
 * @jest-environment node
 */
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "../../../..");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

describe("NAC AI control protocol", () => {
  test("STATE.json is protocolVersion 1 with budget and lock fields", () => {
    const state = readJson("ai-control/STATE.json");
    expect(state.protocolVersion).toBe(1);
    expect(state.branch).toBe("release/ask-nac-fabric-founding-day");
    expect(state.budgetPolicy.onDemandAllowed).toBe(false);
    expect(state.budgetPolicy.individualUsagePercentOfficiallyObservable).toBe(false);
    expect(state.budgetPolicy.softStopPercent).toBe(88);
    expect(state.lock).toBeTruthy();
  });

  test("NEXT_TASK.md carries a taskId", () => {
    const md = fs.readFileSync(path.join(root, "ai-control/NEXT_TASK.md"), "utf8");
    expect(md).toMatch(/taskId:\s*NAC-(CTRL|COMMS|COMMERCE|FOODICS)-/);
    expect(md).toMatch(/onDemandAllowed:\s*false/);
    expect(md).toMatch(/mergeToMain:\s*false/);
  });

  test("OSS registry still rejects OpenClaw and uses Open-Meteo", () => {
    const oss = fs.readFileSync(
      path.join(root, "supabase/functions/_shared/companyIntelligence/externalReality/ossReferenceRegistry.ts"),
      "utf8",
    );
    expect(oss).toMatch(/name: "OpenClaw"/);
    expect(oss).toMatch(/adoption: "REJECTED"/);
    expect(oss).toMatch(/name: "Open-Meteo"/);
    expect(oss).toMatch(/adoption: "USE"/);
    expect(oss).toMatch(/CONTROL_PROTOCOL_META/);
    expect(oss).toMatch(/validated: true/);
  });
});
