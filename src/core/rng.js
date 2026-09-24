/**
 * mulberry32: a small seeded 32-bit PRNG.
 * @param {number} seed unsigned 32-bit integer
 * @returns {() => number} returns floats in [0, 1)
 */
export function mulberry32(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`seed must be an unsigned 32-bit integer, got ${seed}`);
  }
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
