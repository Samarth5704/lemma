import { neighbours, toIndex, toXY } from './grid.js';

/** @typedef {'single' | 'subset'} Rule */

/**
 * @typedef {object} Why
 * @property {Rule} rule the rule that first decided the cell
 * @property {number[]} clues indices of the revealed numbers the rule was
 *   applied to: one for 'single', two for 'subset'; ascending. Cells decided
 *   earlier in the same call count as known, but the numbers behind them are
 *   not repeated here; see deps
 * @property {number[]} deps cells decided earlier in the same call whose
 *   status the rule relied on: the decided covered neighbours of the clue(s)
 *   in `clues`, ascending. Direct pointers only; proof.explainChain walks
 *   them transitively
 */

/**
 * @typedef {object} Deduction
 * @property {number[]} safe covered cells proven safe, ascending
 * @property {number[]} mines covered cells proven mines, ascending
 * @property {Map<number, Why>} why one entry per cell in `safe` and `mines`
 */

/**
 * The part of a game the clue view reads. Mines are deliberately absent.
 * @typedef {object} ClueSource
 * @property {Uint8Array} cells 0 covered, 1 flagged, 2 revealed
 * @property {Uint8Array | null} counts
 * @property {number | null} detonated
 */

/**
 * What the player can see: the number on each revealed cell, and -1 for every
 * covered or flagged cell. A detonated mine is not a number, so it reads -1
 * too. This is the solver's only input, so it cannot see mines, hidden counts
 * or flags.
 * @param {ClueSource} game
 * @returns {Int8Array}
 */
export function visibleClues(game) {
  const out = new Int8Array(game.cells.length).fill(-1);
  const { counts } = game;
  if (counts === null) return out;
  for (let i = 0; i < out.length; i++) {
    if (game.cells[i] === 2 && i !== game.detonated) out[i] = counts[i];
  }
  return out;
}

const UNKNOWN = 0;
const SAFE = 1;
const MINE = 2;

/**
 * Neighbour lists for every cell, from grid.neighbours. Depends only on the
 * board size, not on the board. The core keeps no module state, so callers
 * that run deduce many times on one size (generate, buildProof) build this
 * once and pass it down.
 * @typedef {number[][]} NeighbourTable
 */

/**
 * @param {number} width
 * @param {number} height
 * @returns {NeighbourTable}
 */
export function neighbourTable(width, height) {
  /** @type {NeighbourTable} */
  const t = [];
  for (let i = 0; i < width * height; i++) t.push(neighbours(width, height, i));
  return t;
}

/**
 * Applies the single-clue rule and the subset rule to a fixpoint over the
 * revealed numbers. Sound: every cell it returns is decided by the clues
 * alone. It does not use flags or the global mine count.
 * @param {number} width
 * @param {number} height
 * @param {Int8Array} clues from visibleClues: a count, or -1 if covered
 * @param {NeighbourTable} [table] neighbourTable(width, height), built here if
 *   omitted
 * @returns {Deduction}
 */
export function deduce(width, height, clues, table) {
  const n = width * height;
  if (clues.length !== n) {
    throw new RangeError(`clues has length ${clues.length}, expected ${n}`);
  }
  if (table !== undefined && table.length !== n) {
    throw new RangeError(`table has length ${table.length}, expected ${n}`);
  }
  const nbrs = table ?? neighbourTable(width, height);

  // For covered cells: UNKNOWN, SAFE or MINE as decided in this call.
  const known = new Uint8Array(n);
  /** @type {Map<number, Why>} */
  const why = new Map();
  // Per clue: its undecided covered neighbours, its decided covered
  // neighbours, and the mines still needed among the undecided ones.
  // Recomputed only after a neighbour is decided.
  /** @type {number[][]} */
  const unk = new Array(n);
  /** @type {number[][]} */
  const dec = new Array(n);
  const rem = new Int16Array(n);
  const dirty = new Uint8Array(n).fill(1);

  /** @param {number} c */
  const refresh = (c) => {
    if (!dirty[c]) return;
    dirty[c] = 0;
    /** @type {number[]} */
    const u = [];
    /** @type {number[]} */
    const d = [];
    let k = 0;
    for (const x of nbrs[c]) {
      if (clues[x] >= 0) continue;
      if (known[x] === UNKNOWN) u.push(x);
      else {
        d.push(x);
        if (known[x] === MINE) k++;
      }
    }
    unk[c] = u;
    dec[c] = d;
    rem[c] = clues[c] - k;
  };

  /** @type {number[]} */
  const frontier = [];
  /** @type {number[]} */
  let queue = [];
  let head = 0;
  const queued = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (clues[i] < 0) continue;
    if (nbrs[i].some((x) => clues[x] < 0)) {
      frontier.push(i);
      queue.push(i);
      queued[i] = 1;
    }
  }

  /**
   * @param {number[]} cells undecided cells to decide
   * @param {number} value SAFE or MINE
   * @param {Rule} rule
   * @param {number[]} used the clue(s) applied, ascending
   * @param {number[]} deps decided cells those clues relied on, ascending
   */
  const decide = (cells, value, rule, used, deps) => {
    for (const x of cells) {
      known[x] = value;
      why.set(x, { rule, clues: used.slice(), deps: deps.slice() });
      for (const c of nbrs[x]) {
        if (clues[c] < 0) continue;
        dirty[c] = 1;
        if (!queued[c]) {
          queued[c] = 1;
          queue.push(c);
        }
      }
    }
  };

  const singles = () => {
    while (head < queue.length) {
      const c = queue[head++];
      queued[c] = 0;
      refresh(c);
      const u = unk[c];
      if (u.length === 0) continue;
      if (rem[c] === 0) decide(u, SAFE, 'single', [c], dec[c]);
      else if (rem[c] === u.length) decide(u, MINE, 'single', [c], dec[c]);
    }
    queue = [];
    head = 0;
  };

  // Unknown sets of clues more than 2 apart (Chebyshev) cannot overlap, so
  // only pairs inside a 5x5 window are compared.
  const subsets = () => {
    let progress = false;
    for (const a of frontier) {
      refresh(a);
      const ua = unk[a];
      if (ua.length === 0) continue;
      const { x: ax, y: ay } = toXY(width, a);
      for (let dy = -2; dy <= 2; dy++) {
        const y = ay + dy;
        if (y < 0 || y >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const x = ax + dx;
          if (x < 0 || x >= width) continue;
          if (dx === 0 && dy === 0) continue;
          const b = toIndex(width, x, y);
          if (clues[b] < 0) continue;
          refresh(b);
          const ub = unk[b];
          if (ub.length <= ua.length) continue;
          if (!ua.every((c) => ub.includes(c))) continue;
          const diff = ub.filter((c) => !ua.includes(c));
          const m = rem[b] - rem[a];
          if (m !== 0 && m !== diff.length) continue;
          const used = a < b ? [a, b] : [b, a];
          const deps = dec[a].concat(dec[b].filter((x) => !dec[a].includes(x))).sort((p, q) => p - q);
          decide(diff, m === 0 ? SAFE : MINE, 'subset', used, deps);
          progress = true;
        }
      }
    }
    return progress;
  };

  do singles(); while (subsets());

  /** @type {number[]} */
  const safe = [];
  /** @type {number[]} */
  const mines = [];
  for (let i = 0; i < n; i++) {
    if (known[i] === SAFE) safe.push(i);
    else if (known[i] === MINE) mines.push(i);
  }
  return { safe, mines, why };
}
