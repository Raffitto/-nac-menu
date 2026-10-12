import { applyBusinessSemantics } from "./businessSemantics";
import { normalizeAskNacQuestion } from "./normalizeQuestion";

describe("businessSemantics", () => {
  test("sales yesterday stays a commerce sales question", () => {
    const out = applyBusinessSemantics("sales yesterday");
    expect(out.text).toMatch(/\bsales yesterday\b/i);
    expect(out.text).not.toMatch(/\bnet sales\b/i);
  });

  test("how much did we make yesterday resolves to net sales", () => {
    const out = applyBusinessSemantics("how much did we make yesterday");
    expect(out.text).toMatch(/net sales/i);
  });

  test("guests maps to guest count", () => {
    const out = applyBusinessSemantics("guests yesterday");
    expect(out.text).toMatch(/guest count/i);
  });

  test("delivery sales is preserved", () => {
    const out = applyBusinessSemantics("delivery sales this year");
    expect(out.text).toMatch(/delivery sales/i);
    expect(out.text).not.toMatch(/delivery net sales/i);
  });

  test("normalizeAskNacQuestion applies semantics before routing synonyms", () => {
    const out = normalizeAskNacQuestion("average check this month");
    expect(out.text).toMatch(/average spend/i);
  });
});
