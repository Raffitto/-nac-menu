import { resolveWideRangeTimeout } from "./intelligenceQueryApi";

describe("intelligenceQueryApi wide-range timeout", () => {
  const timeoutErr = Object.assign(new Error("canceling statement due to statement timeout"), {
    code: "57014",
  });

  test("month RPC timeout with empty payload throws — does not substitute Today", () => {
    const res = resolveWideRangeTimeout({
      error: timeoutErr,
      payload: null,
      isEmpty: (p) => !p || !p.total_events,
      hours: 999,
    });
    expect(res.throwError).toBe(timeoutErr);
    expect(res.partial).toBe(true);
    expect(res.note).toMatch(/Month-to-date query timed out/);
  });

  test("month RPC timeout with partial rollup keeps rollup and marks partial", () => {
    const res = resolveWideRangeTimeout({
      error: timeoutErr,
      payload: { total_events: 10, funnel: { qr_scans: 8 } },
      isEmpty: (p) => !p || !(Number(p.total_events) > 0),
      hours: 999,
    });
    expect(res.throwError).toBeNull();
    expect(res.partial).toBe(true);
    expect(res.note).toMatch(/partial data only/);
  });

  test("today timeout does not use wide-range handler", () => {
    const res = resolveWideRangeTimeout({
      error: timeoutErr,
      payload: null,
      isEmpty: () => true,
      hours: 24,
    });
    expect(res.throwError).toBe(timeoutErr);
    expect(res.partial).toBe(false);
  });
});
