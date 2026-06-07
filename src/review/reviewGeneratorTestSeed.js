/**
 * Deterministic Math.random for review engine verification tests.
 */

export function createSeededRandom(seed = 0x4e414301) {
  let state = seed >>> 0;
  return function seededRandom() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function mockSeededMathRandom(seed = 0x4e414301) {
  return jest.spyOn(Math, "random").mockImplementation(createSeededRandom(seed));
}
