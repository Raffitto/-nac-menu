import { createAuthLock } from "./authLock";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("document auth lock", () => {
  test("a waiter does not run after it times out", async () => {
    const lock = createAuthLock({ deadlineMs: 30 });
    const holder = deferred();
    const held = lock("lock:test", 30, () => holder.promise);
    let ran = false;
    const waiting = lock("lock:test", 30, async () => {
      ran = true;
      return "late";
    });
    await expect(waiting).rejects.toThrow("Auth lock timed out");
    expect(ran).toBe(false);
    holder.resolve("holder");
    await expect(held).resolves.toBe("holder");
  });

  test("the holder is not rejected by the acquire deadline", async () => {
    const lock = createAuthLock({ deadlineMs: 40 });
    const result = await lock("lock:test", 1, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "done";
    });
    expect(result).toBe("done");
  });

  test("a waiter receives the result after the holder finishes", async () => {
    const lock = createAuthLock({ deadlineMs: 200 });
    const holder = deferred();
    const held = lock("lock:test", 5000, () => holder.promise);
    const waiting = lock("lock:test", 5000, async () => "next");
    holder.resolve("first");
    await expect(held).resolves.toBe("first");
    await expect(waiting).resolves.toBe("next");
  });

  test("a timed-out waiter never runs, and the next callback waits for fn()", async () => {
    const lock = createAuthLock({ deadlineMs: 30 });
    let active = 0;
    let maxActive = 0;
    const holder = deferred();
    const track = (run) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await run();
      } finally {
        active -= 1;
      }
    };

    const held = lock("lock:test", 30, track(() => holder.promise));
    const waiting = lock("lock:test", 30, track(async () => "late"));
    await expect(waiting).rejects.toThrow("Auth lock timed out");
    expect(maxActive).toBe(1);

    let ran = false;
    const next = lock("lock:test", 200, track(async () => {
      ran = true;
      return "next";
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toBe(false);
    expect(maxActive).toBe(1);

    holder.resolve("holder");
    await expect(held).resolves.toBe("holder");
    await expect(next).resolves.toBe("next");
    expect(maxActive).toBe(1);
  });

  test("an immediate acquire skips a busy lock and does not run", async () => {
    const lock = createAuthLock({ deadlineMs: 200 });
    const holder = deferred();
    const held = lock("lock:test", 5000, () => holder.promise);
    let ran = false;
    await expect(lock("lock:test", 0, async () => {
      ran = true;
    })).rejects.toThrow("Auth lock timed out");
    expect(ran).toBe(false);
    holder.resolve("ok");
    await held;
  });

  test("a rejected holder does not poison the next operation", async () => {
    const lock = createAuthLock({ deadlineMs: 40 });
    await expect(lock("lock:test", 40, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await expect(lock("lock:test", 40, async () => "recovered")).resolves.toBe("recovered");
  });

  test("does not request a Web Lock", async () => {
    const requests = [];
    const original = global.navigator;
    global.navigator = {
      locks: {
        request: (...args) => {
          requests.push(args);
          return new Promise(() => {});
        },
      },
    };
    const lock = createAuthLock({ deadlineMs: 20 });
    await expect(lock("lock:test", 5000, async () => "local")).resolves.toBe("local");
    expect(requests).toHaveLength(0);
    global.navigator = original;
  });
});
