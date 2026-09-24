import { decideBuildReload, readBuildIdFromHtml } from "./buildRecovery";

describe("build recovery", () => {
  test("reloads once when the server document is newer", () => {
    expect(decideBuildReload("aaa", "bbb", null)).toBe(true);
    expect(decideBuildReload("aaa", "bbb", "bbb")).toBe(false);
  });

  test("does not reload when the runtime already matches", () => {
    expect(decideBuildReload("3cee0ae", "3cee0ae", null)).toBe(false);
    expect(decideBuildReload("local-1", "abc", null)).toBe(false);
    expect(decideBuildReload("abc", "%REACT_APP_BUILD_ID%", null)).toBe(false);
  });

  test("reads the build-id meta tag", () => {
    expect(readBuildIdFromHtml('<meta name="build-id" content="3cee0ae" />')).toBe("3cee0ae");
  });
});
