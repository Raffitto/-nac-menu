import { NavigatorLockAcquireTimeoutError } from "@supabase/auth-js";
import { NAC_FETCH_DEADLINE_MS } from "./fetchDeadline";

/**
 * Document-local replacement for navigator.locks.
 *
 * Supabase serializes auth on `lock:<storageKey>`. The previous helper raced
 * the entire Web Lock request, including the critical section, and rejected
 * with "Auth lock timed out" while `navigator.locks.request` kept running.
 * Safari does not reliably abort that request, so the timed-out caller left
 * a queued callback holding the lock. Later Menu and Ask NAC calls then
 * failed even though the user was still signed in.
 *
 * This queue:
 * - runs at most one auth operation at a time in this document
 * - does not call the Web Locks API
 * - applies the deadline only to waiters, never to the holder of fn()
 * - drops a timed-out waiter so it cannot run fn() later
 * - if the holder is still inside fn() when the existing fetch deadline
 *   passes, detaches that holder so the next operation can acquire the lock
 */
export function createAuthLock({ deadlineMs = NAC_FETCH_DEADLINE_MS } = {}) {
  const slots = new Map();

  function slotFor(name) {
    let slot = slots.get(name);
    if (!slot) {
      slot = { held: false, generation: 0, queue: [] };
      slots.set(name, slot);
    }
    return slot;
  }

  function arm(slot, waiter) {
    const generation = slot.generation + 1;
    slot.generation = generation;
    slot.held = true;
    if (waiter.timer) clearTimeout(waiter.timer);
    Promise.resolve()
      .then(() => waiter.fn())
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        if (slot.generation !== generation) return;
        slot.held = false;
        drain(slot);
      });
  }

  function drain(slot) {
    while (slot.queue.length && slot.queue[0].dropped) slot.queue.shift();
    const next = slot.queue.shift();
    if (!next) {
      slot.held = false;
      return;
    }
    arm(slot, next);
  }

  function timeoutError() {
    return new NavigatorLockAcquireTimeoutError("Auth lock timed out");
  }

  return async function nacAuthLock(name, acquireTimeout, fn) {
    const slot = slotFor(String(name || "nac-auth"));
    const requested = Number(acquireTimeout);
    const immediate = requested === 0;

    if (!slot.held && slot.queue.length === 0) {
      return await new Promise((resolve, reject) => {
        arm(slot, { fn, resolve, reject, timer: null, dropped: false });
      });
    }

    if (immediate) {
      throw timeoutError();
    }

    const waitMs = Math.max(requested > 0 ? requested : 0, deadlineMs);

    return await new Promise((resolve, reject) => {
      const waiter = { fn, resolve, reject, timer: null, dropped: false };
      waiter.timer = setTimeout(() => {
        waiter.dropped = true;
        const index = slot.queue.indexOf(waiter);
        if (index >= 0) slot.queue.splice(index, 1);
        if (slot.held) {
          slot.generation += 1;
          slot.held = false;
          drain(slot);
        }
        reject(timeoutError());
      }, waitMs);
      slot.queue.push(waiter);
    });
  };
}

export const nacAuthLock = createAuthLock();
