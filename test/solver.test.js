import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deduce, visibleClues, neighbourTable } from '../src/core/solver.js';
import { computeCounts, flood } from '../src/core/grid.js';
import { placeMines } from '../src/core/generate.js';
import { mulberry32 } from '../src/core/rng.js';

/**
 * Clue view of a board with the given cells revealed.
 * @param {number} width
 * @param {number} height
 * @param {number[]} mineIdx
 * @param {number[]} revealed
 */
function cluesOf(width, height, mineIdx, revealed) {
  const mines = new Uint8Array(width * height);
  for (const i of mineIdx) mines[i] = 1;
  const counts = computeCounts(width, height, mines);
  const clues = new Int8Array(width * height).fill(-1);
  for (const i of revealed) {
    assert.equal(mines[i], 0, `revealed cell ${i} is a mine`);
    clues[i] = counts[i];
  }
  return clues;
}

/**
 * A playing game object with explicit mines, revealed and flagged cells.
 * @param {number} width
 * @param {number} height
 * @param {number[]} mineIdx
 * @param {number[]} revealed
 * @param {number[]} flagged
 */
function game(width, height, mineIdx, revealed, flagged) {
  const mines = new Uint8Array(width * height);
  for (const i of mineIdx) mines[i] = 1;
  const cells = new Uint8Array(width * height);
  for (const i of revealed) cells[i] = 2;
  for (const i of flagged) cells[i] = 1;
  return { cells, counts: computeCounts(width, height, mines), detonated: null };
}

// ---- visibleClues ----

test('visibleClues returns -1 for every covered and every flagged cell, including flagged mines and flagged safe cells', () => {
  // 4x3, mines at 0 and 11. Revealed: 5, 6. Flagged: 0 (a mine), 7 (safe).
  const g = game(4, 3, [0, 11], [5, 6], [0, 7]);
  const clues = visibleClues(g);
  assert.ok(clues instanceof Int8Array);
  assert.equal(clues[5], 1);
  assert.equal(clues[6], 1);
  for (let i = 0; i < 12; i++) {
    if (i === 5 || i === 6) continue;
    assert.equal(clues[i], -1, `cell ${i}`);
  }
});

test('visibleClues returns all -1 before the first click', () => {
  const clues = visibleClues({ cells: new Uint8Array(9), counts: null, detonated: null });
  assert.deepEqual([...clues], new Array(9).fill(-1));
});

test('visibleClues treats a detonated mine as covered, not as a number', () => {
  const g = game(4, 3, [0, 11], [5, 6, 0], []);
  const clues = visibleClues({ ...g, detonated: 0 });
  assert.equal(clues[0], -1);
  assert.equal(clues[5], 1);
});

// ---- deduce: patterns ----

test('a 1 with exactly one covered neighbour proves that neighbour is a mine', () => {
  // 3x2, mine at 0. Everything except 0 revealed: 1 at index 1 has only 0 covered.
  const clues = cluesOf(3, 2, [0], [1, 2, 3, 4, 5]);
  const d = deduce(3, 2, clues);
  assert.deepEqual(d.mines, [0]);
  assert.deepEqual(d.safe, []);
  assert.equal(d.why.get(0)?.rule, 'single');
});

test('a 1 with two covered neighbours and no other clue proves nothing', () => {
  // 1x3 strip: 0 covered mine, 1 revealed "1", 2 covered safe. The 1 sees
  // both 0 and 2, so neither is decided.
  const clues = cluesOf(1, 3, [0], [1]);
  const d = deduce(1, 3, clues);
  assert.deepEqual(d.mines, []);
  assert.deepEqual(d.safe, []);
});

test('the 1-1 pattern against a wall proves the third cell safe', () => {
  // 4x2. Row 0 covered (0..3). Row 1: 4 = "1", 5 = "1", 6 and 7 covered.
  // The wall is x = 0. Mine at 0.
  const clues = cluesOf(4, 2, [0], [4, 5]);
  assert.equal(clues[4], 1);
  assert.equal(clues[5], 1);
  const d = deduce(4, 2, clues);
  assert.ok(d.safe.includes(2), `safe = ${d.safe}`);
  assert.equal(d.why.get(2)?.rule, 'subset');
  assert.deepEqual(d.why.get(2)?.clues, [4, 5]);
  assert.ok(!d.safe.includes(0) && !d.safe.includes(1), 'the 1-1 pair itself stays undecided');
  assert.deepEqual(d.mines, []);
});

test('the 1-2 pattern against a wall proves the correct mine', () => {
  // 4x2. Row 0 covered (0..3), row 1 revealed (4..7). Mines at 0 and 2.
  // Row 1 reads 1 2 1 1. {0,1} holds 1 and {0,1,2} holds 2, so 2 is a mine.
  const clues = cluesOf(4, 2, [0, 2], [4, 5, 6, 7]);
  assert.deepEqual([...clues.slice(4)], [1, 2, 1, 1]);
  const d = deduce(4, 2, clues);
  assert.ok(d.mines.includes(2));
  assert.equal(d.why.get(2)?.rule, 'subset');
  assert.deepEqual(d.why.get(2)?.clues, [4, 5]);
  assert.deepEqual(d.mines, [0, 2]);
  assert.deepEqual(d.safe, [1, 3]);
});

test('a symmetric 50/50 (two cells, one mine, no other information) is reported as stuck', () => {
  // 2x2: row 0 covered, row 1 is "1 1". Both clues see exactly {0, 1}.
  const clues = cluesOf(2, 2, [0], [2, 3]);
  const d = deduce(2, 2, clues);
  assert.deepEqual(d.safe, []);
  assert.deepEqual(d.mines, []);
  assert.equal(d.why.size, 0);
});

test('a mine found by one clue counts as known for another clue in the same call', () => {
  // 5x1, mine at 1. Clue 0 ("1") sees only 1, so 1 is a mine. Clue 2 ("1")
  // sees 1 and 3; with 1 known, 3 is safe.
  const clues = cluesOf(5, 1, [1], [0, 2]);
  assert.deepEqual([...clues], [1, -1, 1, -1, -1]);
  const d = deduce(5, 1, clues);
  assert.deepEqual(d.mines, [1]);
  assert.deepEqual(d.safe, [3]);
  assert.deepEqual(d.why.get(3), { rule: 'single', clues: [2], deps: [1] });
});

test('a safe cell found by one clue counts as known for another clue in the same call', () => {
  // 4x1, mine at 0. Revealed: 1 (a "1" seeing 0 and 2) and 3 (a "0" seeing 2).
  // Clue 3 proves 2 safe. Clue 1 then has one unknown (0) and needs one mine,
  // so 0 is a mine by the single rule, relying on the safe cell from clue 3.
  const clues = cluesOf(4, 1, [0], [1, 3]);
  assert.deepEqual([...clues], [-1, 1, -1, 0]);
  const d = deduce(4, 1, clues);
  assert.deepEqual(d.safe, [2]);
  assert.deepEqual(d.mines, [0]);
  assert.deepEqual(d.why.get(2), { rule: 'single', clues: [3], deps: [] });
  assert.deepEqual(d.why.get(0), { rule: 'single', clues: [1], deps: [2] }, 'why names the clue applied and the decided cell it relied on');
});

test('deduce output arrays are sorted ascending and why covers exactly safe and mines', () => {
  const rng = mulberry32(99);
  const cfg = { width: 16, height: 16, mines: 40 };
  const minesArr = placeMines(cfg, 136, rng);
  const counts = computeCounts(16, 16, minesArr);
  const cells = new Uint8Array(256);
  flood(16, 16, counts, cells, [136]);
  const clues = new Int8Array(256).fill(-1);
  for (let i = 0; i < 256; i++) if (cells[i] === 2) clues[i] = counts[i];
  const d = deduce(16, 16, clues);
  assert.ok(d.safe.length + d.mines.length > 0, 'precondition: something was proven');
  for (const xs of [d.safe, d.mines]) {
    for (let k = 1; k < xs.length; k++) assert.ok(xs[k - 1] < xs[k]);
  }
  assert.deepEqual([...d.why.keys()].sort((a, b) => a - b), [...d.safe, ...d.mines].sort((a, b) => a - b));
  for (const { clues: cs } of d.why.values()) {
    assert.ok(cs.length > 0);
    for (let k = 1; k < cs.length; k++) assert.ok(cs[k - 1] < cs[k]);
    for (const c of cs) assert.ok(clues[c] >= 0, `cited clue ${c} is not a revealed number`);
  }
});

test('deduce rejects a clue array whose length is not width*height', () => {
  assert.throws(() => deduce(3, 3, new Int8Array(8)), RangeError);
});

test('deduce gives the same result with a passed neighbour table as without, and rejects a table for another size', () => {
  const clues = cluesOf(4, 2, [0, 2], [4, 5, 6, 7]);
  assert.deepEqual(deduce(4, 2, clues, neighbourTable(4, 2)), deduce(4, 2, clues));
  assert.throws(() => deduce(4, 2, clues, neighbourTable(3, 2)), RangeError);
});

// ---- deduce: flags and soundness ----

test('a wrong player flag in the state does not change any deduction', () => {
  // 4x2, mines at 0 and 2, row 1 revealed (the 1-2 board above).
  const base = game(4, 2, [0, 2], [4, 5, 6, 7], []);
  const wrong = game(4, 2, [0, 2], [4, 5, 6, 7], [1, 3]); // both flags on safe cells
  const right = game(4, 2, [0, 2], [4, 5, 6, 7], [0, 2]);
  const d0 = deduce(4, 2, visibleClues(base));
  assert.deepEqual(deduce(4, 2, visibleClues(wrong)), d0);
  assert.deepEqual(deduce(4, 2, visibleClues(right)), d0);
  assert.deepEqual(d0.safe, [1, 3], 'the flagged safe cells are still proven safe');
});

test('soundness over 2000 seeded random boards and random partial states', () => {
  const configs = [
    { width: 9, height: 9, mines: 10 },
    { width: 16, height: 16, mines: 40 },
    { width: 30, height: 16, mines: 99 },
    { width: 8, height: 8, mines: 20 },
  ];
  let proven = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const rng = mulberry32(seed);
    const cfg = configs[seed % configs.length];
    const { width: w, height: h } = cfg;
    const n = w * h;
    const first = Math.floor(rng() * n);
    const mines = placeMines(cfg, first, rng);
    const counts = computeCounts(w, h, mines);
    const cells = new Uint8Array(n);
    if (seed % 2 === 0) {
      // Play-like: the opening plus a few random safe reveals with flood.
      flood(w, h, counts, cells, [first]);
      const extra = Math.floor(rng() * 8);
      for (let k = 0; k < extra; k++) {
        const i = Math.floor(rng() * n);
        if (!mines[i] && cells[i] === 0) flood(w, h, counts, cells, [i]);
      }
    } else {
      // Arbitrary: each safe cell revealed independently, with no flood.
      const p = 0.2 + 0.6 * rng();
      for (let i = 0; i < n; i++) if (!mines[i] && rng() < p) cells[i] = 2;
    }
    const clues = new Int8Array(n).fill(-1);
    for (let i = 0; i < n; i++) if (cells[i] === 2) clues[i] = counts[i];
    const d = deduce(w, h, clues);
    for (const i of d.safe) {
      assert.equal(mines[i], 0, `seed ${seed}: ${i} proven safe but is a mine`);
      assert.equal(cells[i], 0, `seed ${seed}: ${i} proven safe but already revealed`);
    }
    for (const i of d.mines) assert.equal(mines[i], 1, `seed ${seed}: ${i} proven mine but is safe`);
    proven += d.safe.length + d.mines.length;
  }
  assert.ok(proven > 20000, `only ${proven} cells proven over 2000 states; the check is near-vacuous`);
});
