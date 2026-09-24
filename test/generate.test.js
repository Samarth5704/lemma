import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, placeMines } from '../src/core/generate.js';
import { mulberry32 } from '../src/core/rng.js';
import { neighbours } from '../src/core/grid.js';

const BEGINNER = { width: 9, height: 9, mines: 10 };
const EXPERT = { width: 30, height: 16, mines: 99 };

/** @param {Uint8Array} mines */
const countMines = (mines) => mines.reduce((a, b) => a + b, 0);

test('for 1000 seeds on Expert, no mine lands on the first-click cell or its neighbours, and the mine count is exactly 99', () => {
  const cells = EXPERT.width * EXPERT.height;
  for (let seed = 0; seed < 1000; seed++) {
    const first = seed % cells;
    const mines = placeMines(EXPERT, first, mulberry32(seed));
    assert.equal(mines.length, cells);
    assert.equal(countMines(mines), 99, `seed ${seed}`);
    assert.equal(mines[first], 0, `seed ${seed}`);
    for (const n of neighbours(EXPERT.width, EXPERT.height, first)) {
      assert.equal(mines[n], 0, `seed ${seed} neighbour ${n}`);
    }
  }
});

test('a first click in a corner excludes only 4 cells, and the mine count is still exact', () => {
  const { width: w } = EXPERT;
  const excluded = new Set([0, 1, w, w + 1]);
  const everMined = new Uint8Array(w * EXPERT.height);
  for (let seed = 0; seed < 1000; seed++) {
    const mines = placeMines(EXPERT, 0, mulberry32(seed));
    assert.equal(countMines(mines), 99);
    for (const i of excluded) assert.equal(mines[i], 0);
    mines.forEach((m, i) => { if (m) everMined[i] = 1; });
  }
  for (let i = 0; i < everMined.length; i++) {
    assert.equal(everMined[i], excluded.has(i) ? 0 : 1, `cell ${i}`);
  }
});

test('the same seed and the same first click produce an identical board', () => {
  for (const seed of [0, 7, 4294967295]) {
    const a = placeMines(EXPERT, 200, mulberry32(seed));
    const b = placeMines(EXPERT, 200, mulberry32(seed));
    assert.deepEqual(a, b);
  }
  assert.notDeepEqual(placeMines(EXPERT, 200, mulberry32(1)), placeMines(EXPERT, 200, mulberry32(2)));
});

test('a config with mines > cells - 9 is rejected', () => {
  assert.equal(validateConfig({ width: 9, height: 9, mines: 72 }).ok, true);
  assert.equal(validateConfig({ width: 9, height: 9, mines: 73 }).ok, false);
  assert.throws(() => placeMines({ width: 9, height: 9, mines: 73 }, 40, mulberry32(1)), RangeError);
});

test('a config with a zero, negative or non-integer dimension or mine count is rejected', () => {
  for (const bad of [
    { width: 0, height: 9, mines: 1 },
    { width: 9, height: -9, mines: 1 },
    { width: 9, height: 9, mines: 0 },
    { width: 9.5, height: 9, mines: 10 },
    { width: 9, height: 9, mines: 10.5 },
    { width: 3, height: 3, mines: 1 },
  ]) {
    assert.equal(validateConfig(bad).ok, false, JSON.stringify(bad));
  }
});

test('non-preset sizes are accepted by config validation', () => {
  assert.equal(validateConfig({ width: 5, height: 4, mines: 11 }).ok, true);
  assert.equal(validateConfig({ width: 200, height: 200, mines: 1 }).ok, true);
});

test('placeMines rejects a first click outside the board', () => {
  assert.throws(() => placeMines(BEGINNER, -1, mulberry32(1)), RangeError);
  assert.throws(() => placeMines(BEGINNER, 81, mulberry32(1)), RangeError);
});

test('placeMines on 9x9 with 10 mines and centre first click mines every eligible cell at 0.9x to 1.1x of the expected rate over 20,000 seeds', () => {
  const N = 20000;
  const centre = 40;
  const excluded = new Set([centre, ...neighbours(9, 9, centre)]);
  const eligible = 81 - excluded.size;
  assert.equal(eligible, 72);
  const expected = (N * BEGINNER.mines) / eligible;
  const hits = new Uint32Array(81);
  for (let seed = 0; seed < N; seed++) {
    const mines = placeMines(BEGINNER, centre, mulberry32(seed));
    for (let i = 0; i < 81; i++) hits[i] += mines[i];
  }
  for (let i = 0; i < 81; i++) {
    if (excluded.has(i)) {
      assert.equal(hits[i], 0, `excluded cell ${i}`);
    } else {
      const ratio = hits[i] / expected;
      assert.ok(ratio >= 0.9 && ratio <= 1.1, `cell ${i}: ${hits[i]} hits, ratio ${ratio.toFixed(3)}`);
    }
  }
});
