import { fetchWithDeadline, isRefreshTokenRequest } from "./fetchDeadline";

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

  test("does not abort a refresh-token attempt when the deadline passes", async () => {
    let sawAbort = false;
    global.fetch = (_input, init) => new Promise((resolve) => {
      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          sawAbort = true;
        });
      }
      setTimeout(() => resolve({ ok: true }), 40);
    });

    const url = "https://example.test/auth/v1/token?grant_type=refresh_token";
    expect(isRefreshTokenRequest(url)).toBe(true);
    await expect(fetchWithDeadline(url, {}, 15)).resolves.toEqual({ ok: true });
    expect(sawAbort).toBe(false);
  });

  test("still aborts a refresh-token attempt when the caller cancels", async () => {
    const caller = new AbortController();
    global.fetch = (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
    const pending = fetchWithDeadline(
      "https://example.test/auth/v1/token?grant_type=refresh_token",
      { signal: caller.signal },
      500,
    );
    caller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
