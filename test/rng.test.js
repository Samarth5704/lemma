import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/rng.js';

test('mulberry32 produces the same sequence for the same seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('mulberry32 matches the reference C implementation', () => {
  // First three uint32 outputs per seed, from compiling the C in Tommy
  // Ettinger's gist 46a874533244883189143505d203312c.
  const vectors = [
    [0, [1144304738, 1416247, 958946056]],
    [1, [2693262067, 11749833, 2265367787]],
    [42, [2581720956, 1925393290, 3661312704]],
    [4294967295, [3850105811, 813802916, 3073704848]],
  ];
  for (const [seed, expected] of /** @type {[number, number[]][]} */ (vectors)) {
    const r = mulberry32(seed);
    for (const [k, want] of expected.entries()) {
      assert.equal(r() * 2 ** 32, want, `seed ${seed} output ${k}`);
    }
  }
});

test('mulberry32 produces different sequences for seeds 1 and 2', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a() === b()) same++;
  assert.ok(same < 100);
});

test('10,000 mulberry32 outputs all fall in [0, 1)', () => {
  for (const seed of [0, 1, 0xffffffff]) {
    const r = mulberry32(seed);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      assert.ok(v >= 0 && v < 1, `seed ${seed} output ${i} = ${v}`);
    }
  }
});

test('mulberry32 rejects a seed that is not an unsigned 32-bit integer', () => {
  for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity]) {
    assert.throws(() => mulberry32(bad), RangeError, String(bad));
  }
});
