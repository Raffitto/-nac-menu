import { bootMarks, markBoot } from "./bootTelemetry";

describe("bootTelemetry", () => {
  test("records marks without throwing", () => {
    markBoot("test_mark");
    expect(bootMarks().test_mark).toEqual(expect.any(Number));
  });

  test("records Tier-1 path marks used by Overview cold load", () => {
    markBoot("tier1_fetch_start");
    markBoot("tier1_session_ready");
    markBoot("tier1_full_ready");
    const marks = bootMarks();
    expect(marks.tier1_fetch_start).toEqual(expect.any(Number));
    expect(marks.tier1_session_ready).toEqual(expect.any(Number));
    expect(marks.tier1_full_ready).toEqual(expect.any(Number));
  });
});
