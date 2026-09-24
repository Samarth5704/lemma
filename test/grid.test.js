import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellCount, toIndex, toXY, neighbours } from '../src/core/grid.js';

test('a cell at x = width-1 does not list x = 0 of the next row as a neighbour', () => {
  const w = 9, h = 9;
  for (let y = 0; y < h; y++) {
    const i = toIndex(w, w - 1, y);
    for (const n of neighbours(w, h, i)) {
      assert.notEqual(toXY(w, n).x, 0, `cell (${w - 1},${y}) lists ${n}`);
    }
  }
});

test('a cell at x = 0 does not list x = width-1 of the previous row', () => {
  const w = 30, h = 16;
  for (let y = 0; y < h; y++) {
    const i = toIndex(w, 0, y);
    for (const n of neighbours(w, h, i)) {
      assert.notEqual(toXY(w, n).x, w - 1, `cell (0,${y}) lists ${n}`);
    }
  }
});

test('corner cells have 3 neighbours, edge cells have 5, and interior cells have 8', () => {
  for (const [w, h] of [[9, 9], [16, 16], [30, 16]]) {
    for (let i = 0; i < cellCount(w, h); i++) {
      const { x, y } = toXY(w, i);
      const onX = x === 0 || x === w - 1;
      const onY = y === 0 || y === h - 1;
      const expected = onX && onY ? 3 : onX || onY ? 5 : 8;
      assert.equal(neighbours(w, h, i).length, expected, `${w}x${h} (${x},${y})`);
    }
  }
});

test('neighbours are unique, exclude the cell itself, and are within one step on each axis', () => {
  const w = 30, h = 16;
  for (let i = 0; i < cellCount(w, h); i++) {
    const ns = neighbours(w, h, i);
    assert.equal(new Set(ns).size, ns.length);
    assert.ok(!ns.includes(i));
    const a = toXY(w, i);
    for (const n of ns) {
      const b = toXY(w, n);
      assert.ok(Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1);
    }
  }
});

test('a 1-wide column has 1 neighbour at each end and 2 in the middle', () => {
  assert.deepEqual(neighbours(1, 3, 0), [1]);
  assert.deepEqual(neighbours(1, 3, 1), [0, 2]);
  assert.deepEqual(neighbours(1, 3, 2), [1]);
});

test('toIndex and toXY round-trip on 30x16', () => {
  for (let i = 0; i < cellCount(30, 16); i++) {
    const { x, y } = toXY(30, i);
    assert.equal(toIndex(30, x, y), i);
  }
});
