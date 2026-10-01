import { actionOverlayCopy, createActionLock, NAC_ACTION_OVERLAY_DELAY_MS } from "./nacActionGuard";

describe("NAC action guard", () => {
  test("locks immediately and ignores a second acquire", () => {
    const lock = createActionLock();
    expect(lock.tryAcquire()).toBe(true);
    expect(lock.tryAcquire()).toBe(false);
    expect(lock.isHeld()).toBe(true);
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });

  test("does not show overlay copy before the delay, then shows the operation", () => {
    expect(actionOverlayCopy(0, "Posting receipt…")).toBeNull();
    expect(actionOverlayCopy(NAC_ACTION_OVERLAY_DELAY_MS, "Posting receipt…")).toBe("Posting receipt…");
    expect(actionOverlayCopy(9000, "Posting receipt…")).toMatch(/Still working/);
  });
});
