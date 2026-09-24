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

  test("a stuck holder does not block the following operation", async () => {
    const lock = createAuthLock({ deadlineMs: 25 });
    const stuck = lock("lock:test", 25, () => new Promise(() => {}));
    const waiting = lock("lock:test", 25, async () => "recovered");
    await expect(waiting).rejects.toThrow("Auth lock timed out");
    await expect(lock("lock:test", 25, async () => "fresh")).resolves.toBe("fresh");
    const raced = await Promise.race([
      stuck.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("still-held"), 10)),
    ]);
    expect(raced).toBe("still-held");
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
