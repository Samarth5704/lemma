import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProof, explainLoss, explainChain } from '../src/core/proof.js';
import { deduce, neighbourTable } from '../src/core/solver.js';
import { reveal, chord } from '../src/core/rules.js';
import { computeCounts, neighbours } from '../src/core/grid.js';

/** @typedef {import('../src/core/rules.js').Game} Game */

/**
 * @param {number} n
 * @param {number[]} idx
 */
function maskOf(n, idx) {
  const m = new Uint8Array(n);
  for (const i of idx) m[i] = 1;
  return m;
}

/**
 * A 'playing' game with an explicit mine layout, bypassing generation.
 * @param {number} width
 * @param {number} height
 * @param {number[]} mineIdx
 * @param {number[]} revealed
 * @param {number[]} [flagged]
 * @returns {Game}
 */
function build(width, height, mineIdx, revealed, flagged = []) {
  const n = width * height;
  const mines = maskOf(n, mineIdx);
  const cells = new Uint8Array(n);
  for (const i of revealed) cells[i] = 2;
  for (const i of flagged) cells[i] = 1;
  return {
    width, height, mineCount: mineIdx.length, seed: 0,
    firstClick: revealed[0], status: 'playing', detonated: null,
    lossCause: null, lossAction: null, cells, mines,
    counts: computeCounts(width, height, mines),
    accumulatedMs: 0, resumedAt: 0,
  };
}

// ---- buildProof ----

test('the first click is step 0 with rule opening, and the cells its flood opens are step 0 with rule flood', () => {
  // 5x3, one mine at 4 (top-right). A click at 10 floods every safe cell,
  // all of it at step 0.
  const p = buildProof(5, 3, maskOf(15, [4]), 10);
  assert.equal(p.stepOf[10], 0);
  assert.equal(p.ruleOf[10], 'opening');
  assert.deepEqual(p.cluesOf[10], []);
  const counts = computeCounts(5, 3, maskOf(15, [4]));
  let floods = 0;
  for (let i = 0; i < 15; i++) {
    if (i === 10 || i === 4) continue;
    if (p.stepOf[i] !== 0) continue;
    floods++;
    assert.equal(p.ruleOf[i], 'flood', `cell ${i}`);
    const z = /** @type {number[]} */ (p.cluesOf[i])[0];
    assert.equal(counts[z], 0, `cell ${i} was opened by ${z}, which is not a zero`);
    assert.ok(neighbours(5, 3, i).includes(z));
  }
  assert.ok(floods >= 10, `only ${floods} cells flooded at step 0`);
  assert.equal(p.solved, true);
});

test('mines have step -1 and rule null', () => {
  const p = buildProof(5, 3, maskOf(15, [4]), 10);
  assert.equal(p.stepOf[4], -1);
  assert.equal(p.ruleOf[4], null);
  assert.equal(p.cluesOf[4], null);
});

test('a board ending in a symmetric 50/50 is not solved, and the two cells stay unreached', () => {
  // 2x5: rows 0..4. Click at (0,4) = 8 excludes rows 3..4. One mine at (0,0) = 0.
  // Row 1 reads "1 1", and both see exactly {0, 1}: a 50/50.
  const mines = maskOf(10, [0]);
  const p = buildProof(2, 5, mines, 8);
  assert.equal(p.solved, false);
  assert.equal(p.stepOf[1], -1, 'the safe half of the 50/50 is unreached');
  assert.equal(p.ruleOf[1], null);
  for (const i of [2, 3, 4, 5, 6, 7, 8, 9]) assert.equal(p.stepOf[i], 0, `cell ${i}`);
});

test('a board needing the subset rule records subset at step 1 and single at step 2', () => {
  // 4x3, click at (0,1) = 4 excludes x 0..1. Mines at 3 and 10. The opening
  // reveals x 0..1 plus 2 ("1") and 6 ("2"). Step 1: clue 5 proves 10 a mine,
  // then {3,7} (clue 2, one mine) is inside {3,7,11} (clue 6, one mine left),
  // so 11 is safe by subset. Step 2: 11 reads 1, already met by 10, so 7 is safe.
  const mines = maskOf(12, [3, 10]);
  const p = buildProof(4, 3, mines, 4);
  assert.equal(p.solved, true);
  assert.deepEqual([...p.stepOf], [0, 0, 0, -1, 0, 0, 0, 2, 0, 0, -1, 1]);
  assert.equal(p.ruleOf[4], 'opening');
  assert.equal(p.ruleOf[11], 'subset');
  assert.deepEqual(p.cluesOf[11], [2, 6], 'the subset pair');
  assert.equal(p.ruleOf[7], 'single');
  assert.deepEqual(p.cluesOf[7], [11]);
  for (const i of [0, 1, 2, 5, 6, 8, 9]) assert.equal(p.ruleOf[i], 'flood', `cell ${i}`);
  assert.deepEqual(p.summary, { steps: 2, singleCells: 1, subsetCells: 1, floodCells: 7 });
});

test('summary counts match the per-cell rules and steps', () => {
  const mines = maskOf(12, [3, 10]);
  const p = buildProof(4, 3, mines, 4);
  let single = 0, subset = 0, fl = 0, maxStep = 0;
  for (let i = 0; i < 12; i++) {
    if (p.ruleOf[i] === 'single') single++;
    if (p.ruleOf[i] === 'subset') subset++;
    if (p.ruleOf[i] === 'flood') fl++;
    maxStep = Math.max(maxStep, p.stepOf[i]);
  }
  assert.deepEqual(p.summary, { steps: maxStep, singleCells: single, subsetCells: subset, floodCells: fl });
});

test('buildProof gives the same trace with a passed neighbour table as without, and rejects a table for another size', () => {
  const mines = maskOf(12, [3, 10]);
  assert.deepEqual(buildProof(4, 3, mines, 4, neighbourTable(4, 3)), buildProof(4, 3, mines, 4));
  assert.throws(() => buildProof(4, 3, mines, 4, neighbourTable(3, 3)), RangeError);
});

test('buildProof rejects a mine array of the wrong length and a mined first click', () => {
  assert.throws(() => buildProof(3, 3, new Uint8Array(8), 4), RangeError);
  assert.throws(() => buildProof(3, 3, maskOf(9, [4]), 4), RangeError);
});

// ---- explainLoss: reveal ----

test('explainLoss returns provable mine with the correct clues for a click on a deducible mine', () => {
  // 4x2 1-2 board: mines 0 and 2, row 1 revealed and reads 1 2 1 1.
  // {0,1} holds 1 and {0,1,2} holds 2, so 2 is a mine by clues 4 and 5.
  const g = build(4, 2, [0, 2], [4, 5, 6, 7]);
  const { state } = reveal(g, 2, 100);
  assert.equal(state.status, 'lost');
  assert.equal(state.lossAction, 2);
  assert.deepEqual(explainLoss(state), { kind: 'reveal', provable: 'mine', clues: [4, 5] });
});

test('explainLoss returns provable no and a genuinely safe cell for a click on a non-deducible mine', () => {
  // 4x2 1-1 board: mine at 0, revealed 4 and 5 (both "1"). 0 and 1 are a
  // 50/50, but the subset rule proves 2 and 6 safe. Both are at Chebyshev
  // distance 2 from the click at 0; the tie goes to the lower index, 2.
  const g = build(4, 2, [0], [4, 5]);
  const { state } = reveal(g, 0, 100);
  assert.equal(state.status, 'lost');
  const ex = explainLoss(state);
  assert.deepEqual(ex, { kind: 'reveal', provable: 'no', safe: 2, clues: [4, 5] });
  assert.equal(state.mines?.[2], 0, 'the named cell is genuinely safe');
  assert.equal(state.cells[2], 0, 'the named cell was covered');
});

test('explainLoss names the provably safe cell nearest the click, not the lowest index', () => {
  // 7x2, mines at 0 and 6. Row 1 revealed at 7, 8 ("1 1") and 12, 13 ("1 1").
  // Left pair proves 2 and 9 safe; right pair proves 4 and 11 safe. The click
  // at 6 is 2 from 4 and 11, and 4 from 2 and 9: the answer is 4.
  const g = build(7, 2, [0, 6], [7, 8, 12, 13]);
  const { state } = reveal(g, 6, 100);
  const ex = explainLoss(state);
  assert.equal(ex.kind, 'reveal');
  assert.equal(ex.kind === 'reveal' && ex.provable, 'no');
  assert.equal(ex.kind === 'reveal' && ex.provable === 'no' && ex.safe, 4);
});

test('on an ungenerated board with a forced 50/50, explainLoss returns provable none', () => {
  // 2x2: mine at 0, row 1 reads "1 1". Nothing is provable once 0 is covered again.
  const g = build(2, 2, [0], [2, 3]);
  const { state } = reveal(g, 0, 100);
  assert.deepEqual(explainLoss(state), { kind: 'reveal', provable: 'none' });
});

test('explainLoss on a reveal loss ignores the detonated cell as a clue', () => {
  // The detonated mine is revealed in the lost state. If it were read as a
  // number, the answer could change; the pre-click state had it covered.
  const g = build(4, 2, [0, 2], [4, 5, 6, 7]);
  const lost = reveal(g, 2, 100).state;
  const pre = reveal(g, 2, 100).state;
  pre.cells[2] = 0;
  assert.deepEqual(explainLoss(lost), explainLoss({ ...pre, status: 'lost' }));
});

test('explainLoss cites the upstream number when a mine is proved through a chain', () => {
  // 4x2, mines at 0 and 3; row 1 (4..7) revealed and reads 1 1 1 1.
  // Clues 4 and 5 prove 2 safe (subset). With 2 known safe, clues 6 and 7
  // prove 1 safe (subset). Only then does clue 5 see one unknown, 0: a mine.
  // Clue 5 alone cannot prove 0; the proof runs through 4, 6 and 7.
  const g = build(4, 2, [0, 3], [4, 5, 6, 7]);
  const { state } = reveal(g, 0, 100);
  const d = deduce(4, 2, Int8Array.from([-1, -1, -1, -1, 1, 1, 1, 1]));
  assert.deepEqual(d.why.get(0)?.clues, [5], 'precondition: the direct clue alone is 5');
  const ex = explainLoss(state);
  assert.equal(ex.kind === 'reveal' && ex.provable, 'mine');
  assert.ok(ex.kind === 'reveal' && ex.provable === 'mine');
  assert.ok(ex.clues.includes(5), 'the number that decided 0');
  assert.ok(ex.clues.includes(6) && ex.clues.includes(7), 'the upstream numbers that decided 1');
  assert.deepEqual(ex.clues, [4, 5, 6, 7]);
});

test('why.deps names only cells decided earlier in the same call, and explainChain walks them transitively', () => {
  // Same chain as above: 2 <- {4,5}; 1 <- {6,7} relying on 2; 0 <- {5} relying on 1 and 2.
  const d = deduce(4, 2, Int8Array.from([-1, -1, -1, -1, 1, 1, 1, 1]));
  assert.deepEqual(d.why.get(2)?.deps, []);
  assert.deepEqual(d.why.get(1)?.deps, [2]);
  assert.deepEqual(d.why.get(0)?.deps, [1, 2]);
  for (const [cell, w] of d.why) {
    for (const x of w.deps) assert.ok(d.why.has(x), `dep ${x} of ${cell} was not decided`);
  }
  assert.deepEqual(explainChain(d.why, 2), [4, 5]);
  assert.deepEqual(explainChain(d.why, 1), [4, 5, 6, 7]);
  assert.deepEqual(explainChain(d.why, 0), [4, 5, 6, 7]);
});

test('explainLoss cites the upstream numbers behind the named safe cell in a provable no result', () => {
  // 4x2: row 0 = 0, 1*, 2 (a "3"), 3; row 1 = 4 (a "2"), 5*, 6*, 7 (a "1").
  // Click 6. Clue 7 sees {3, 6} with one mine, so 6 is not provable. Clue 7's
  // set sits inside clue 2's {1, 3, 5, 6} with three mines, so 1 and 5 are
  // mines (subset). Only then does clue 4 ("2", sees 0, 1, 5) prove 0 safe.
  const g = build(4, 2, [1, 5, 6], [2, 4, 7]);
  const { state } = reveal(g, 6, 100);
  const d = deduce(4, 2, Int8Array.from([-1, -1, 3, -1, 2, -1, -1, 1]));
  assert.deepEqual(d.why.get(0), { rule: 'single', clues: [4], deps: [1, 5] }, 'precondition: 0 is decided by 4 alone, relying on 1 and 5');
  assert.deepEqual(explainLoss(state), { kind: 'reveal', provable: 'no', safe: 0, clues: [2, 4, 7] });
});

// ---- explainLoss: chord ----

test('a chord loss with two wrong flags lists both in wrongFlags, and detonated is a real mine', () => {
  // 5x3, mines 1, 3, 11, 13; centre 7 is a 4. Flags on 1, 3 (right) and 2, 6
  // (wrong): 4 flags, so the chord fires and hits 11.
  const g = build(5, 3, [1, 3, 11, 13], [7], [1, 3, 2, 6]);
  const { state } = chord(g, 7, 100);
  assert.equal(state.status, 'lost');
  assert.equal(state.lossCause, 'chord');
  const ex = explainLoss(state);
  assert.deepEqual(ex, { kind: 'chord', chorded: 7, wrongFlags: [2, 6], detonated: 11 });
  assert.equal(state.mines?.[11], 1);
});

test('explainLoss throws on a state that is not lost', () => {
  const g = build(4, 2, [0], [4, 5]);
  assert.throws(() => explainLoss(g), RangeError);
});
