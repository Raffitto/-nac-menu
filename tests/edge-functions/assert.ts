// Minimal assertion helpers so edge-function tests need nothing outside this repo.
export class AssertionError extends Error {}
export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new AssertionError(msg);
}
export function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(`${msg ? msg + ": " : ""}expected ${e}, got ${a}`);
}
