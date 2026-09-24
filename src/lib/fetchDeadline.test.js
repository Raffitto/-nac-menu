import { fetchWithDeadline } from "./fetchDeadline";

describe("fetchWithDeadline", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("aborts the underlying fetch when the deadline passes", async () => {
    let sawAbort = false;
    global.fetch = (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        sawAbort = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });

    await expect(fetchWithDeadline("https://example.test", {}, 20)).rejects.toThrow("aborted");
    expect(sawAbort).toBe(true);
  });
});
