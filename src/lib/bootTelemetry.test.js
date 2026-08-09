import { bootMarks, markBoot } from "./bootTelemetry";

describe("bootTelemetry", () => {
  test("records marks without throwing", () => {
    markBoot("test_mark");
    expect(bootMarks().test_mark).toEqual(expect.any(Number));
  });
});
