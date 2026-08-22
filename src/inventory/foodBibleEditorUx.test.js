import fs from "fs";
import path from "path";

describe("Food Bible editor UX CSS", () => {
  const css = fs.readFileSync(path.join(__dirname, "foodBibleEditorUx.css"), "utf8");

  test("locks the editor to the viewport and scrolls only the active pane", () => {
    expect(css).toMatch(/\.fb-card-overlay[\s\S]*width:\s*100vw/);
    expect(css).toMatch(/\.fb-card-overlay[\s\S]*height:\s*100dvh/);
    expect(css).toMatch(/\.fb-card-overlay[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(/\.fb-card__workspace[\s\S]*overflow:\s*hidden/);
    expect(css).toMatch(/\.fb-card__table-wrap[\s\S]*overflow:\s*auto/);
    expect(css).toMatch(/\.fb-card__method[\s\S]*overflow:\s*auto/);
  });

  test("covers common laptop widths without reverting to a scrolling modal", () => {
    expect(css).toMatch(/max-width:\s*100vw/);
    expect(css).toMatch(/min-height:\s*100dvh/);
    expect(css).toMatch(/max-height:\s*800px/);
    expect(css).not.toMatch(/\.fb-card-overlay[\s\S]{0,80}overflow:\s*auto/);
  });
});
