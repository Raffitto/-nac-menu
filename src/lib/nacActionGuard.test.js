import {
  ACTION_SCOPE,
  actionOverlayCopy,
  beginGuardedAction,
  classifyGuardOutcome,
  createActionLock,
  endGuardedAction,
  listGuardedActions,
  NAC_ACTION_OVERLAY_DELAY_MS,
  resetGuardedActions,
  runGuardedAction,
} from "./nacActionGuard";

describe("NAC action guard", () => {
  afterEach(() => {
    resetGuardedActions();
  });

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

  test("a global action blocks another action, and a local action does not", () => {
    expect(beginGuardedAction({ id: "save-note", scope: ACTION_SCOPE.LOCAL, label: "Saving…" })).toBe(true);
    expect(beginGuardedAction({ id: "save-other", scope: ACTION_SCOPE.LOCAL, label: "Saving…" })).toBe(true);
    expect(beginGuardedAction({ id: "publish", scope: ACTION_SCOPE.GLOBAL, label: "Publishing…" })).toBe(false);
    endGuardedAction("save-note");
    endGuardedAction("save-other");
    expect(beginGuardedAction({ id: "publish", scope: ACTION_SCOPE.GLOBAL, label: "Publishing…" })).toBe(true);
    expect(beginGuardedAction({ id: "publish", scope: ACTION_SCOPE.GLOBAL, label: "Publishing…" })).toBe(false);
    expect(beginGuardedAction({ id: "save-note", scope: ACTION_SCOPE.LOCAL, label: "Saving…" })).toBe(false);
  });

  test("a thrown operation still releases the lock", async () => {
    await expect(runGuardedAction({
      id: "save",
      operation: async () => { throw new Error("nope"); },
    })).rejects.toThrow("nope");
    expect(listGuardedActions()).toEqual([]);
    expect(beginGuardedAction({ id: "save", label: "Saving…" })).toBe(true);
  });

  test("an uncertain mutation stays blocked until the server record is known", () => {
    expect(classifyGuardOutcome({ error: new Error("Fetch is aborted") }).state).toBe("uncertain");
    expect(classifyGuardOutcome({ error: new Error("timeout"), confirmed: true }).state).toBe("success");
    expect(classifyGuardOutcome({ error: new Error("timeout"), confirmed: false }).retry).toBe(true);
    expect(classifyGuardOutcome({ error: new Error("Price is required") })).toMatchObject({
      state: "rejected",
      retry: true,
    });
  });
});
