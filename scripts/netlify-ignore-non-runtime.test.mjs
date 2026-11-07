import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { shouldBuild, isReviewOnlyBranch } from "./netlify-ignore-non-runtime.mjs";

describe("netlify ignore", () => {
  test("docs and tests skip", () => {
    assert.equal(shouldBuild(["docs/architecture/note.md", "src/App.test.js", ".github/workflows/ci.yml"]), false);
  });

  test("a runtime file builds even beside docs", () => {
    assert.equal(shouldBuild(["docs/readme.md", "src/App.js"]), true);
  });

  test("public images, package.json, and netlify.toml build", () => {
    assert.equal(shouldBuild(["public/menu-icons/latte-480.webp"]), true);
    assert.equal(shouldBuild(["package.json"]), true);
    assert.equal(shouldBuild(["netlify.toml"]), true);
  });

  test("an empty diff skips", () => {
    assert.equal(shouldBuild([]), false);
  });
});

test("review branch skips all automatic Netlify builds, without blocking main or other branches", () => {
  assert.equal(isReviewOnlyBranch("codex/nac-master-menu-reconciliation"), true);
  assert.equal(isReviewOnlyBranch("main"), false);
  assert.equal(isReviewOnlyBranch("another-feature"), false);
  assert.equal(isReviewOnlyBranch(undefined), false);
});
