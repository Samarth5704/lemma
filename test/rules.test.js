import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, reveal, flag, chord, pause, resume, elapsed, status, counter,
} from '../src/core/rules.js';
import { neighbours, computeCounts, flood } from '../src/core/grid.js';

/** @typedef {import('../src/core/rules.js').Game} Game */
/** @typedef {import('../src/core/rules.js').Result} Result */

/**
 * Builds a 'playing' game with an explicit mine layout, bypassing placement.
 * @param {number} width
 * @param {number} height
 * @param {number[]} mineIdx
 * @param {number[]} [revealed]
 * @param {number[]} [flagged]
 * @returns {Game}
 */
function build(width, height, mineIdx, revealed = [], flagged = []) {
  const n = width * height;
  const mines = new Uint8Array(n);
  for (const i of mineIdx) mines[i] = 1;
  const cells = new Uint8Array(n);
  for (const i of revealed) cells[i] = 2;
  for (const i of flagged) cells[i] = 1;
  return {
    width, height, mineCount: mineIdx.length, seed: 0,
    firstClick: revealed.length ? revealed[0] : null,
    status: 'playing', detonated: null, lossCause: null, cells, mines,
    counts: computeCounts(width, height, mines),
    accumulatedMs: 0, resumedAt: 0,
  };
}

/**
 * Runs an action and asserts the input game was not mutated.
 * @template {any[]} A
 * @param {(g: Game, ...a: A) => Result} fn
 * @param {Game} game
 * @param {A} args
 */
function act(fn, game, ...args) {
  const before = structuredClone(game);
  const result = fn(game, ...args);
  assert.deepEqual(game, before, `${fn.name} mutated its input`);
  assert.notEqual(result.state, game, `${fn.name} returned the input object`);
  return result;
}

/** @param {Result} r @param {Game} g */
function assertNoOp(r, g) {
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.state, g);
}

/**
 * 5x3, mines at (1,0) (3,0) (1,2) (3,2). Every safe cell has a count > 0.
 * Centre (2,1) = index 7 is a 4. Its covered safe neighbours are 2, 6, 8, 12.
 */
const W = 5, H = 3, MINES = [1, 3, 11, 13], CENTRE = 7;
const SAFE = [0, 2, 4, 5, 6, 7, 8, 9, 10, 12, 14];

// ---- flood ----

test('a flood from a zero stops at numbered cells and does not open a flagged cell inside the region', () => {
  // 5x5 with a wall of mines at x = 2. The flag at (0,2) sits inside the zero region.
  const g = build(5, 5, [2, 7, 12, 17, 22], [], [10]);
  assert.equal(g.counts?.[0], 0);
  assert.equal(g.counts?.[10], 0, 'the flagged cell is a zero inside the region');
  const { state, changed } = act(reveal, g, 0, 100);
  assert.deepEqual(changed, [0, 1, 5, 6, 11]);
  assert.equal(state.cells[10], 1, 'flag stays a flag');
  for (let y = 0; y < 5; y++) for (let x = 3; x < 5; x++) assert.equal(state.cells[5 * y + x], 0);
  assert.equal(state.status, 'playing');
});

test('flood opens each cell exactly once: 479 unique on 30x16 with one corner mine', () => {
  const g = build(30, 16, [0]);
  const cells = g.cells.slice();
  // A cell is marked visited when enqueued and opened when dequeued, so a
  // duplicate enqueue would show up as a duplicate in `opened`.
  const { opened } = flood(30, 16, /** @type {Uint8Array} */ (g.counts), cells, [479]);
  assert.equal(new Set(opened).size, opened.length, 'a cell was enqueued twice');
  assert.equal(opened.length, 479, 'every safe cell opened exactly once');
});

test('a flood on a 200x200 board with one mine completes and wins', () => {
  const g = build(200, 200, [0]);
  const { state, changed } = reveal(g, 39999, 0);
  assert.equal(state.status, 'won');
  assert.equal(changed.length, 40000, '39,999 opened plus the auto-flagged mine');
});

// ---- reveal / flag no-ops ----

test('revealing a flagged cell is a no-op', () => {
  const g = build(W, H, MINES, [CENTRE], [0]);
  assertNoOp(act(reveal, g, 0, 100), g);
});

test('revealing an already revealed cell is a no-op', () => {
  const g = build(W, H, MINES, [CENTRE]);
  assertNoOp(act(reveal, g, CENTRE, 100), g);
});

test('flagging a revealed cell is a no-op', () => {
  const g = build(W, H, MINES, [CENTRE]);
  assertNoOp(act(flag, g, CENTRE), g);
});

test('flag toggles a covered cell on and off and reports it as changed', () => {
  const g = build(W, H, MINES, [CENTRE]);
  const on = act(flag, g, 0);
  assert.equal(on.state.cells[0], 1);
  assert.deepEqual(on.changed, [0]);
  const off = act(flag, on.state, 0);
  assert.equal(off.state.cells[0], 0);
  assert.deepEqual(off.changed, [0]);
});

test('flagging before the first click is allowed and does not start the timer', () => {
  const g = newGame({ width: 9, height: 9, mines: 10 }, 1);
  const { state, changed } = act(flag, g, 0);
  assert.equal(state.cells[0], 1);
  assert.deepEqual(changed, [0]);
  assert.equal(state.status, 'ready');
  assert.equal(state.resumedAt, null);
});

// ---- chord ----

test('chord with fewer flags than the number is a no-op', () => {
  const g = build(W, H, MINES, [CENTRE], [1, 3, 11]);
  assertNoOp(act(chord, g, CENTRE, 100), g);
});

test('chord with more flags than the number is a no-op', () => {
  const g = build(W, H, MINES, [CENTRE], [1, 3, 11, 13, 2]);
  assertNoOp(act(chord, g, CENTRE, 100), g);
});

test('chord with correct flags opens every remaining covered neighbour', () => {
  const g = build(W, H, MINES, [CENTRE], MINES);
  const covered = neighbours(W, H, CENTRE).filter((n) => g.cells[n] === 0);
  assert.deepEqual(covered, [2, 6, 8, 12]);
  // Precondition: no covered neighbour is a zero, so no flood can connect them.
  for (const n of covered) assert.ok((g.counts?.[n] ?? 0) > 0, `neighbour ${n} is a zero`);
  const { state, changed } = act(chord, g, CENTRE, 100);
  assert.deepEqual(changed, [2, 6, 8, 12]);
  for (const n of covered) assert.equal(state.cells[n], 2);
  // Precondition: the chord did not win the board, so the test is not vacuous.
  assert.equal(state.status, 'playing');
  for (const i of [0, 4, 5, 9, 10, 14]) assert.equal(state.cells[i], 0);
});

test('chord with a wrong flag loses, and the detonated index is the mine that was revealed', () => {
  // Flag 2 (safe) instead of 13 (mine). Flag count 4 equals the number.
  const g = build(W, H, MINES, [CENTRE], [1, 3, 11, 2]);
  const { state, changed } = act(chord, g, CENTRE, 100);
  assert.equal(state.status, 'lost');
  assert.equal(state.detonated, 13);
  assert.equal(state.cells[13], 2);
  assert.deepEqual(changed, [2, 13], 'the wrong flag and the detonated mine change visibly');
  for (const n of [6, 8, 12]) assert.equal(state.cells[n], 0, 'other neighbours are not opened');
});

test('chord with a wrong flag loses with lossCause chord', () => {
  const g = build(W, H, MINES, [CENTRE], [1, 3, 11, 2]);
  assert.equal(g.lossCause, null);
  const { state } = act(chord, g, CENTRE, 100);
  assert.equal(state.status, 'lost');
  assert.equal(state.lossCause, 'chord');
});

test('a chord that reaches a zero cascades its flood', () => {
  // 5x3, one mine at 0. Centre-left (1,1) = 6 is a 1; its neighbour (2,1) = 7 is a zero.
  const g = build(5, 3, [0], [6], [0]);
  assert.equal(g.counts?.[7], 0);
  const { state, changed } = act(chord, g, 6, 100);
  assert.equal(state.cells[9], 2, '(4,1) is not a neighbour of 6 and was opened by the cascade');
  assert.ok(changed.includes(9));
  assert.equal(state.status, 'won');
});

test('chord on a covered cell is a no-op', () => {
  const g = build(W, H, MINES, [CENTRE], MINES);
  assertNoOp(act(chord, g, 0, 100), g);
});

test('chord on a revealed zero is a no-op', () => {
  const g = build(5, 3, [0], [4]);
  assert.equal(g.counts?.[4], 0);
  assertNoOp(act(chord, g, 4, 100), g);
});

// ---- win / loss ----

test('revealing the last safe cell wins with zero flags placed', () => {
  const g = build(W, H, MINES, SAFE.filter((i) => i !== 14));
  g.resumedAt = 1000;
  assert.equal(g.cells.filter((c) => c === 1).length, 0);
  const { state, changed } = act(reveal, g, 14, 4000);
  assert.equal(state.status, 'won');
  for (const m of MINES) assert.equal(state.cells[m], 1, 'mines are auto-flagged');
  assert.deepEqual(changed, [1, 3, 11, 13, 14]);
  assert.equal(state.accumulatedMs, 3000);
  assert.equal(state.resumedAt, null);
  assert.equal(counter(state), 0);
});

test('flagging every mine while safe cells remain covered does not win', () => {
  let g = build(W, H, MINES, [CENTRE]);
  for (const m of MINES) g = act(flag, g, m).state;
  assert.equal(status(g), 'playing');
});

test('a first click whose flood reveals every safe cell ends the game as won immediately', () => {
  // One mine does not guarantee a full flood: a mine one step from an edge can
  // wall off the edge cell behind it. So check the implication per seed and
  // require that the won case actually occurs.
  let wins = 0;
  for (let seed = 0; seed < 200; seed++) {
    const g = newGame({ width: 9, height: 9, mines: 1 }, seed);
    const { state } = act(reveal, g, 40, 1000);
    const revealed = state.cells.filter((c) => c === 2).length;
    if (revealed === 80) {
      wins++;
      assert.equal(state.status, 'won', `seed ${seed}`);
      assert.equal(state.firstClick, 40);
      assert.equal(state.resumedAt, null);
      assert.equal(elapsed(state, 9999), 0);
    } else {
      assert.equal(state.status, 'playing', `seed ${seed}`);
    }
  }
  assert.ok(wins >= 50, `only ${wins} of 200 first clicks flooded the board`);
});

test('revealing a mine loses, sets detonated, and reports every mine and wrong flag as changed', () => {
  const g = build(W, H, MINES, [CENTRE], [1, 2]);
  const { state, changed } = act(reveal, g, 3, 100);
  assert.equal(state.status, 'lost');
  assert.equal(state.detonated, 3);
  assert.equal(state.lossCause, 'reveal');
  assert.equal(state.cells[3], 2);
  assert.equal(state.cells[1], 1, 'a correct flag is left alone');
  assert.deepEqual(changed, [2, 3, 11, 13]);
});

test('a loss folds the running segment into accumulatedMs and stops the clock', () => {
  const g = build(W, H, MINES, [CENTRE]);
  g.accumulatedMs = 500;
  g.resumedAt = 1000;
  const { state } = reveal(g, 1, 4000);
  assert.equal(state.status, 'lost');
  assert.equal(state.accumulatedMs, 3500);
  assert.equal(state.resumedAt, null);
  assert.equal(elapsed(state, 99999), 3500);
});

test('reveal, flag and chord after a win are all no-ops', () => {
  const won = reveal(build(W, H, MINES, SAFE.filter((i) => i !== 14)), 14, 0).state;
  assert.equal(won.status, 'won');
  assertNoOp(act(reveal, won, 0, 1), won);
  assertNoOp(act(flag, won, 1), won);
  assertNoOp(act(chord, won, CENTRE, 1), won);
});

test('reveal, flag and chord after a loss are all no-ops', () => {
  const lost = reveal(build(W, H, MINES, [CENTRE], [1, 3, 11]), 13, 0).state;
  assert.equal(lost.status, 'lost');
  assertNoOp(act(reveal, lost, 0, 1), lost);
  assertNoOp(act(flag, lost, 0), lost);
  assertNoOp(act(chord, lost, CENTRE, 1), lost);
});

// ---- first click ----

test('the first reveal places mines, records the first click and starts the timer', () => {
  const g = newGame({ width: 9, height: 9, mines: 10 }, 42);
  assert.equal(g.status, 'ready');
  assert.equal(g.mines, null);
  assert.equal(g.lossCause, null);
  const { state } = act(reveal, g, 40, 5000);
  assert.equal(state.firstClick, 40);
  assert.notEqual(state.mines, null);
  assert.equal(state.mines?.[40], 0);
  assert.equal(state.resumedAt, 5000);
  assert.ok(state.status === 'playing' || state.status === 'won');
});

test('the same seed and the same first click produce an identical game', () => {
  const a = reveal(newGame({ width: 30, height: 16, mines: 99 }, 7), 100, 0).state;
  const b = reveal(newGame({ width: 30, height: 16, mines: 99 }, 7), 100, 0).state;
  assert.deepEqual(a, b);
});

test('newGame rejects an invalid config and an invalid seed', () => {
  assert.throws(() => newGame({ width: 9, height: 9, mines: 73 }, 1), RangeError);
  assert.throws(() => newGame({ width: 9, height: 9, mines: 10 }, -1), RangeError);
});

test('reveal, flag and chord reject an index outside the board', () => {
  const g = build(W, H, MINES, [CENTRE]);
  for (const bad of [-1, 15, 1.5]) {
    assert.throws(() => reveal(g, bad, 0), RangeError);
    assert.throws(() => flag(g, bad), RangeError);
    assert.throws(() => chord(g, bad, 0), RangeError);
  }
});

// ---- counter ----

test('the counter reads -1 with 11 flags on Beginner', () => {
  let g = build(9, 9, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [80]);
  for (let i = 0; i < 11; i++) g = flag(g, i).state;
  assert.equal(counter(g), -1);
});

// ---- time ----

/** A Beginner game after a first click at `now` that did not win outright. */
function startedAt(/** @type {number} */ now) {
  for (let seed = 0; ; seed++) {
    const { state } = reveal(newGame({ width: 9, height: 9, mines: 10 }, seed), 40, now);
    if (state.status === 'playing') return state;
  }
}

test('elapsed time is 0 before the first click', () => {
  const g = newGame({ width: 9, height: 9, mines: 10 }, 1);
  assert.equal(elapsed(g, 0), 0);
  assert.equal(elapsed(g, 1e9), 0);
});

test('elapsed time accumulates across a pause and resume', () => {
  let g = startedAt(1000);
  assert.equal(elapsed(g, 3000), 2000);
  g = act(pause, g, 3000).state;
  assert.equal(g.resumedAt, null);
  assert.equal(elapsed(g, 10000), 2000);
  g = act(resume, g, 10000).state;
  assert.equal(elapsed(g, 10500), 2500);
});

test('elapsed time never decreases as now increases', () => {
  let g = startedAt(0);
  let last = -1;
  for (let now = 0; now <= 20000; now += 250) {
    if (now === 5000) g = pause(g, now).state;
    if (now === 9000) g = resume(g, now).state;
    if (now === 12000) g = pause(g, now).state;
    if (now === 12000) g = pause(g, now).state; // double pause
    if (now === 15000) g = resume(g, now).state;
    if (now === 15000) g = resume(g, now).state; // double resume
    const e = elapsed(g, now);
    assert.ok(e >= last, `elapsed went from ${last} to ${e} at ${now}`);
    last = e;
  }
  assert.equal(last, 5000 + 3000 + 5000);
});

test('pause and resume are no-ops before the first click and after the game ends', () => {
  const ready = newGame({ width: 9, height: 9, mines: 10 }, 1);
  assertNoOp(act(pause, ready, 10), ready);
  assertNoOp(act(resume, ready, 10), ready);
  const won = reveal(build(W, H, MINES, SAFE.filter((i) => i !== 14)), 14, 0).state;
  assertNoOp(act(resume, won, 10), won);
  assertNoOp(act(pause, won, 10), won);
});

test('a win while paused keeps the accumulated time unchanged', () => {
  let g = build(W, H, MINES, SAFE.filter((i) => i !== 14));
  g = pause(g, 2000).state;
  assert.equal(g.accumulatedMs, 2000);
  const { state } = reveal(g, 14, 9000);
  assert.equal(state.status, 'won');
  assert.equal(state.accumulatedMs, 2000);
});
