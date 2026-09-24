import { clearInflight, dedupeInflight, inflightSize } from "./requestDedupe";

describe("requestDedupe", () => {
  afterEach(() => clearInflight());

  test("coalesces concurrent identical keys", async () => {
    let calls = 0;
    const loader = () => {
      calls += 1;
      return new Promise((resolve) => setTimeout(() => resolve("ok"), 20));
    };
    const [a, b] = await Promise.all([
      dedupeInflight("bi:today", loader),
      dedupeInflight("bi:today", loader),
    ]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(calls).toBe(1);
    expect(inflightSize()).toBe(0);
  });

  test("separate keys run independently", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };
    await Promise.all([dedupeInflight("a", loader), dedupeInflight("b", loader)]);
    expect(calls).toBe(2);
  });
});
