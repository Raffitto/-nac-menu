import { fetchWithDeadline, isRefreshTokenRequest, deadlineForRequest, NAC_FETCH_DEADLINE_MS, NAC_INVOICE_TRANSFER_DEADLINE_MS } from "./fetchDeadline";

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

  test("keeps the 12s deadline for ordinary REST and a longer one for invoice transfer", () => {
    const storage = "https://example.supabase.co/storage/v1/object/inventory-invoices/khobar/hash/image.jpg";
    const ocr = "https://example.supabase.co/functions/v1/inventory-invoice-ocr";
    const rest = "https://example.supabase.co/rest/v1/inventory_invoices";
    expect(deadlineForRequest(rest, { method: "GET" })).toBe(NAC_FETCH_DEADLINE_MS);
    expect(deadlineForRequest(storage, { method: "POST" })).toBe(NAC_INVOICE_TRANSFER_DEADLINE_MS);
    expect(deadlineForRequest(ocr, { method: "POST" })).toBe(NAC_INVOICE_TRANSFER_DEADLINE_MS);
    expect(deadlineForRequest(storage, { method: "GET" })).toBe(NAC_FETCH_DEADLINE_MS);
  });

  test("arms the long transfer deadline for a storage upload", async () => {
    const spy = jest.spyOn(global, "setTimeout");
    global.fetch = () => Promise.resolve({ ok: true });
    await fetchWithDeadline(
      "https://example.supabase.co/storage/v1/object/inventory-invoices/khobar/hash/image.jpg",
      { method: "POST" },
    );
    expect(spy).toHaveBeenCalledWith(expect.any(Function), NAC_INVOICE_TRANSFER_DEADLINE_MS);
    spy.mockRestore();
  });
});
