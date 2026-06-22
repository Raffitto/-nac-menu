import { applyBusinessSemantics } from "./businessSemantics";
import { normalizeAskNacQuestion } from "./normalizeQuestion";

describe("businessSemantics", () => {
  test("sales yesterday resolves to net sales yesterday", () => {
    const out = applyBusinessSemantics("sales yesterday");
    expect(out.text).toMatch(/net sales/i);
    expect(out.text).toMatch(/yesterday/i);
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
