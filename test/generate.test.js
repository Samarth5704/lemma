import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, placeMines, generate } from '../src/core/generate.js';
import { mulberry32 } from '../src/core/rng.js';
import { neighbours, computeCounts, flood } from '../src/core/grid.js';
import { buildProof } from '../src/core/proof.js';
import { deduce, visibleClues } from '../src/core/solver.js';
import { GENERATE_CAP } from '../src/core/rules.js';

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

// ---- phase 2: no-guess generation ----

const INTERMEDIATE = { width: 16, height: 16, mines: 40 };
const DIFFICULTIES = /** @type {const} */ ([['Beginner', BEGINNER], ['Intermediate', INTERMEDIATE], ['Expert', EXPERT]]);
const BOARDS_PER_DIFFICULTY = 200;

/**
 * An rng that steers placeMines' partial Fisher-Yates onto exactly `target`.
 * It mirrors placeMines: candidates ascending, then for step i pick j in [i, m).
 * @param {import('../src/core/generate.js').Config} config
 * @param {number} firstClick
 * @param {number[]} target mine indices
 */
function steer(config, firstClick, target) {
  const n = config.width * config.height;
  const excluded = new Set([firstClick, ...neighbours(config.width, config.height, firstClick)]);
  const cand = [];
  for (let i = 0; i < n; i++) if (!excluded.has(i)) cand.push(i);
  const floats = [];
  for (let i = 0; i < target.length; i++) {
    const p = cand.indexOf(target[i]);
    assert.ok(p >= i, `target ${target[i]} is not a candidate`);
    floats.push((p - i + 0.5) / (cand.length - i));
    [cand[i], cand[p]] = [cand[p], cand[i]];
  }
  let k = 0;
  return () => floats[k++ % floats.length];
}

/**
 * Generated boards per difficulty, shared across tests. The first click is
 * drawn per seed so corners and edges are covered, not just the centre.
 * @type {Map<string, { seed: number, first: number, mines: Uint8Array, attempts: number }[]>}
 */
const cache = new Map();
/** @param {string} name @param {import('../src/core/generate.js').Config} cfg */
function boards(name, cfg) {
  const hit = cache.get(name);
  if (hit) return hit;
  const n = cfg.width * cfg.height;
  const out = [];
  for (let seed = 0; seed < BOARDS_PER_DIFFICULTY; seed++) {
    const first = Math.floor(mulberry32(seed ^ 0x5bd1e995)() * n);
    const r = generate(cfg, first, mulberry32(seed), GENERATE_CAP);
    assert.ok(r.ok, `${name} seed ${seed} first ${first}: no board within ${GENERATE_CAP} attempts`);
    out.push({ seed, first, mines: r.mines, attempts: r.attempts });
  }
  cache.set(name, out);
  return out;
}

test('generate with the same seed and first click gives an identical result', () => {
  for (const [, cfg] of DIFFICULTIES) {
    const a = generate(cfg, 40, mulberry32(11), GENERATE_CAP);
    const b = generate(cfg, 40, mulberry32(11), GENERATE_CAP);
    assert.deepEqual(a, b);
    assert.ok(a.ok);
  }
});

test('generate on its first attempt returns exactly the board placeMines gives for that rng', () => {
  for (let seed = 0; seed < 50; seed++) {
    const r = generate(BEGINNER, 40, mulberry32(seed), GENERATE_CAP);
    if (r.ok && r.attempts === 1) {
      assert.deepEqual(r.mines, placeMines(BEGINNER, 40, mulberry32(seed)));
      return;
    }
  }
  assert.fail('no first-attempt success in 50 Beginner seeds');
});

test('an impossible config (10x2, 5 mines, click at 4) returns { ok: false } after exactly cap attempts', () => {
  // Why no 10x2 board with an odd mine count can be solved: every column has
  // 0, 1 or 2 mines and the total is odd, so some column k holds exactly one
  // mine m and one safe cell s. On a 2-row board, every cell other than s and
  // m that touches one of them touches both. So swapping s and m changes no
  // number anywhere except on s and m, and the swapped layout is also legal
  // (column k is outside the first-click exclusion because it holds a mine).
  // Every clue the solver could ever see is identical in both layouts, so a
  // sound solver can never prove s safe. Flood cannot open s either: each of
  // its neighbours other than m touches m, so none is a zero. Hence s is never
  // revealed and no attempt can succeed, whatever the rng returns.
  const cfg = { width: 10, height: 2, mines: 5 };
  let calls = 0;
  const base = mulberry32(1);
  const rng = () => { calls++; return base(); };
  const cap = 25;
  const r = generate(cfg, 4, rng, cap);
  assert.deepEqual(r, { ok: false, attempts: cap });
  assert.equal(calls, cap * cfg.mines, 'placeMines ran exactly cap times');
});

test('generate rejects a cap that is not a positive integer', () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => generate(BEGINNER, 40, mulberry32(1), bad), RangeError, String(bad));
  }
});

test('an endgame that only the global mine count can resolve is stuck, and the generator rejects that board', () => {
  // 5x5, mines at 18, 19, 23 around the corner 24. A click at 0 floods every
  // safe cell except 24. The three mines are provable, but 24 touches no
  // revealed number, so only the count (3 mines, 3 found) shows it is safe.
  // The solver does not use the count (rule 9), so it is stuck.
  const cfg = { width: 5, height: 5, mines: 3 };
  const target = [18, 19, 23];
  const mines = placeMines(cfg, 0, steer(cfg, 0, target));
  assert.deepEqual([...mines].flatMap((m, i) => (m ? [i] : [])), target,
    'precondition: the steered rng produces the target board');
  const p = buildProof(5, 5, mines, 0);
  assert.equal(p.solved, false);
  for (let i = 0; i < 25; i++) {
    if (mines[i] || i === 24) assert.equal(p.stepOf[i], -1, `cell ${i}`);
    else assert.ok(p.stepOf[i] >= 0, `cell ${i} unreached`);
  }
  // The final state proves all three mines but no safe cell.
  const counts = computeCounts(5, 5, mines);
  const cells = new Uint8Array(25);
  for (let i = 0; i < 25; i++) if (p.stepOf[i] >= 0) cells[i] = 2;
  const d = deduce(5, 5, visibleClues({ cells, counts, detonated: null }));
  assert.deepEqual(d.mines, target);
  assert.deepEqual(d.safe, []);
  assert.deepEqual(generate(cfg, 0, steer(cfg, 0, target), 1), { ok: false, attempts: 1 });
});

for (const [name, cfg] of DIFFICULTIES) {
  test(`for ${BOARDS_PER_DIFFICULTY} seeds on ${name}, every generated board is cleared by buildProof from its first click`, () => {
    const safe = cfg.width * cfg.height - cfg.mines;
    for (const { seed, first, mines } of boards(name, cfg)) {
      assert.equal(mines.reduce((a, b) => a + b, 0), cfg.mines);
      assert.equal(mines[first], 0);
      const p = buildProof(cfg.width, cfg.height, mines, first);
      assert.equal(p.solved, true, `seed ${seed}`);
      let reached = 0;
      for (const s of p.stepOf) if (s >= 0) reached++;
      assert.equal(reached, safe, `seed ${seed}`);
    }
  });

  test(`in the proof trace on ${name}, every safe cell has exactly one step, and every clue cited at step s was revealed before s`, () => {
    const { width: w, height: h } = cfg;
    for (const { seed, first, mines } of boards(name, cfg)) {
      const counts = computeCounts(w, h, mines);
      const p = buildProof(w, h, mines, first);
      for (let i = 0; i < w * h; i++) {
        const s = p.stepOf[i];
        const rule = p.ruleOf[i];
        const cs = p.cluesOf[i];
        const at = `seed ${seed} cell ${i}`;
        if (mines[i]) {
          assert.equal(s, -1, at);
          assert.equal(rule, null, at);
          continue;
        }
        assert.ok(s >= 0 && cs !== null, at);
        if (rule === 'opening') {
          assert.equal(i, first, at);
          assert.equal(s, 0, at);
        } else if (rule === 'flood') {
          assert.equal(cs.length, 1, at);
          const z = cs[0];
          assert.equal(counts[z], 0, `${at}: opened by ${z}, not a zero`);
          assert.ok(neighbours(w, h, i).includes(z), `${at}: opener ${z} is not adjacent`);
          assert.equal(p.stepOf[z], s, `${at}: opener ${z} opened at a different step`);
        } else {
          assert.ok(rule === 'single' || rule === 'subset', at);
          assert.ok(s >= 1, at);
          assert.ok(cs.length > 0, at);
          for (const c of cs) {
            assert.ok(p.stepOf[c] >= 0 && p.stepOf[c] < s, `${at}: clue ${c} at step ${p.stepOf[c]}, cited at ${s}`);
          }
        }
      }
    }
  });
}

test('a cell opened by flood has rule flood, never single or subset, even when a deduced zero triggered it', () => {
  // Ground truth per round, recomputed without the trace: the cells deduce
  // proves safe from the state before step s are that round's starts. Every
  // other cell opened at step s was opened by cascade and must be 'flood'.
  const { width: w, height: h } = EXPERT;
  let cascades = 0;
  for (const { seed, first, mines } of boards('Expert', EXPERT)) {
    const counts = computeCounts(w, h, mines);
    const p = buildProof(w, h, mines, first);
    for (let s = 1; s <= p.summary.steps; s++) {
      const cells = new Uint8Array(w * h);
      for (let i = 0; i < cells.length; i++) if (p.stepOf[i] >= 0 && p.stepOf[i] < s) cells[i] = 2;
      const starts = new Set(deduce(w, h, visibleClues({ cells, counts, detonated: null })).safe);
      for (let i = 0; i < cells.length; i++) {
        if (p.stepOf[i] !== s) continue;
        const at = `seed ${seed} step ${s} cell ${i}`;
        if (starts.has(i)) {
          assert.ok(p.ruleOf[i] === 'single' || p.ruleOf[i] === 'subset', at);
        } else {
          assert.equal(p.ruleOf[i], 'flood', at);
          const opener = p.ruleOf[/** @type {number[]} */ (p.cluesOf[i])[0]];
          if (opener === 'single' || opener === 'subset') cascades++;
        }
      }
    }
  }
  assert.ok(cascades > 0, 'no deduced zero cascaded on any board; the test is vacuous');
});

test('the loss invariant: before the win, deduce proves at least one covered cell safe at every point, for random safe reveals', () => {
  for (const [name, cfg] of DIFFICULTIES) {
    const { width: w, height: h } = cfg;
    for (const { seed, first, mines } of boards(name, cfg)) {
      const counts = computeCounts(w, h, mines);
      const cells = new Uint8Array(w * h);
      flood(w, h, counts, cells, [first]);
      const rng = mulberry32(seed ^ 0x2545f491);
      for (;;) {
        /** @type {number[]} */
        const covered = [];
        for (let i = 0; i < cells.length; i++) if (cells[i] === 0 && !mines[i]) covered.push(i);
        if (covered.length === 0) break; // won
        const d = deduce(w, h, visibleClues({ cells, counts, detonated: null }));
        assert.ok(d.safe.length > 0, `${name} seed ${seed}: stuck with ${covered.length} safe cells covered`);
        // Any safe cell, proven or not: a lucky guess is allowed.
        flood(w, h, counts, cells, [covered[Math.floor(rng() * covered.length)]]);
      }
    }
  }
});
