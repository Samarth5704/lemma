import { cellCount, neighbours, computeCounts, flood } from './grid.js';
import { validateConfig, placeMines, generate } from './generate.js';
import { mulberry32 } from './rng.js';

/** @typedef {import('./generate.js').Config} Config */

/**
 * Attempt cap for no-guess generation on the first reveal. From the phase 2
 * measurement (docs/spec.md) over centre, edge and corner first clicks: the
 * most attempts any of 500 Expert seeds needed was 257 (corner); four times
 * that is 1028, rounded up to 1100.
 */
export const GENERATE_CAP = 1100;

/** @typedef {'ready' | 'playing' | 'won' | 'lost'} Status */
/** @typedef {'reveal' | 'chord' | null} LossCause */

/**
 * Cell values: 0 covered, 1 flagged, 2 revealed.
 *
 * @typedef {object} Game
 * @property {number} width
 * @property {number} height
 * @property {number} mineCount
 * @property {number} seed
 * @property {number | null} firstClick
 * @property {Status} status
 * @property {number | null} detonated
 * @property {LossCause} lossCause null until a loss; 'chord' means a flag the
 *   chord trusted was wrong, 'reveal' means the player opened a mine directly
 * @property {number | null} lossAction null until a loss; then the index the
 *   player acted on: the clicked cell for a reveal, the chorded number for a
 *   chord
 * @property {Uint8Array} cells
 * @property {Uint8Array | null} mines null before the first click; never mutated once set
 * @property {Uint8Array | null} counts Adjacent mine counts. DERIVED from `mines`
 *   at placement and held in memory only; never mutated once set. Must NEVER be
 *   part of anything that is persisted. Recompute with computeCounts on load.
 * @property {number} accumulatedMs
 * @property {number | null} resumedAt
 */

/**
 * @typedef {object} Result
 * @property {Game} state a new game object; the input is never mutated
 * @property {number[]} changed indices whose visible state changed, unique and ascending
 */

/**
 * @param {Config} config
 * @param {number} seed unsigned 32-bit integer
 * @returns {Game}
 */
export function newGame(config, seed) {
  const v = validateConfig(config);
  if (!v.ok) throw new RangeError(v.error);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`seed must be an unsigned 32-bit integer, got ${seed}`);
  }
  return {
    width: config.width,
    height: config.height,
    mineCount: config.mines,
    seed,
    firstClick: null,
    status: 'ready',
    detonated: null,
    lossCause: null,
    lossAction: null,
    cells: new Uint8Array(cellCount(config.width, config.height)),
    mines: null,
    counts: null,
    accumulatedMs: 0,
    resumedAt: null,
  };
}

/**
 * @param {Game} game
 * @param {number} index
 * @param {number} now
 * @returns {Result}
 */
export function reveal(game, index, now) {
  checkIndex(game, index);
  if (isOver(game) || game.cells[index] !== 0) return noop(game);
  const next = copy(game);
  if (next.status === 'ready') {
    const config = { width: next.width, height: next.height, mines: next.mineCount };
    // No-guess board if one is found within the cap; otherwise a plain random
    // board. Which one it was is derivable (buildProof(...).solved), so it is
    // not stored.
    const generated = generate(config, index, mulberry32(next.seed), GENERATE_CAP);
    next.mines = generated.ok ? generated.mines : placeMines(config, index, mulberry32(next.seed));
    next.counts = computeCounts(next.width, next.height, next.mines);
    next.firstClick = index;
    next.status = 'playing';
    next.resumedAt = now;
  }
  const { mines, counts } = board(next);
  if (mines[index]) return lose(next, index, 'reveal', index, now);
  const { opened } = flood(next.width, next.height, counts, next.cells, [index]);
  return settle(next, opened, now);
}

/**
 * Toggles a flag on a covered cell. Allowed before the first click.
 * @param {Game} game
 * @param {number} index
 * @returns {Result}
 */
export function flag(game, index) {
  checkIndex(game, index);
  if (isOver(game) || game.cells[index] === 2) return noop(game);
  const next = copy(game);
  next.cells[index] = next.cells[index] === 1 ? 0 : 1;
  return { state: next, changed: [index] };
}

/**
 * Opens every covered, unflagged neighbour of a revealed number when the
 * adjacent flag count equals it. Trusts flags: a wrong flag detonates.
 * @param {Game} game
 * @param {number} index
 * @param {number} now
 * @returns {Result}
 */
export function chord(game, index, now) {
  checkIndex(game, index);
  if (game.status !== 'playing' || game.cells[index] !== 2) return noop(game);
  const { mines, counts } = board(game);
  const number = counts[index];
  if (number === 0) return noop(game);
  const ns = neighbours(game.width, game.height, index);
  const flags = ns.filter((n) => game.cells[n] === 1).length;
  if (flags !== number) return noop(game);
  const covered = ns.filter((n) => game.cells[n] === 0);
  if (covered.length === 0) return noop(game);
  const next = copy(game);
  const hit = covered.find((n) => mines[n] === 1);
  if (hit !== undefined) return lose(next, hit, 'chord', index, now);
  const { opened } = flood(next.width, next.height, counts, next.cells, covered);
  return settle(next, opened, now);
}

/**
 * @param {Game} game
 * @param {number} now
 * @returns {Result}
 */
export function pause(game, now) {
  if (game.status !== 'playing' || game.resumedAt === null) return noop(game);
  const next = copy(game);
  fold(next, now);
  return { state: next, changed: [] };
}

/**
 * @param {Game} game
 * @param {number} now
 * @returns {Result}
 */
export function resume(game, now) {
  if (game.status !== 'playing' || game.resumedAt !== null) return noop(game);
  const next = copy(game);
  next.resumedAt = now;
  return { state: next, changed: [] };
}

/**
 * @param {Game} game
 * @param {number} now
 */
export function elapsed(game, now) {
  const running = game.resumedAt === null ? 0 : Math.max(0, now - game.resumedAt);
  return game.accumulatedMs + running;
}

/** @param {Game} game */
export function status(game) {
  return game.status;
}

/**
 * Mines minus flags. May go negative; never clamped.
 * @param {Game} game
 */
export function counter(game) {
  let flags = 0;
  for (const c of game.cells) if (c === 1) flags++;
  return game.mineCount - flags;
}

// ---- internals ----

/** @param {Game} game */
function copy(game) {
  return { ...game, cells: game.cells.slice() };
}

/**
 * @param {Game} game
 * @returns {Result}
 */
function noop(game) {
  return { state: copy(game), changed: [] };
}

/** @param {Game} game */
function isOver(game) {
  return game.status === 'won' || game.status === 'lost';
}

/**
 * @param {Game} game
 * @param {number} index
 */
function checkIndex(game, index) {
  if (!Number.isInteger(index) || index < 0 || index >= game.cells.length) {
    throw new RangeError(`cell index out of range: ${index}`);
  }
}

/**
 * @param {Game} game
 * @returns {{ mines: Uint8Array, counts: Uint8Array }}
 */
function board(game) {
  if (game.mines === null || game.counts === null) {
    throw new Error('board has no mines yet');
  }
  return { mines: game.mines, counts: game.counts };
}

/**
 * Folds the running time segment into accumulatedMs and stops the clock.
 * @param {Game} next mutated in place; always a fresh copy
 * @param {number} now
 */
function fold(next, now) {
  if (next.resumedAt !== null) {
    next.accumulatedMs += Math.max(0, now - next.resumedAt);
    next.resumedAt = null;
  }
}

/**
 * @param {Game} next mutated in place; always a fresh copy
 * @param {number} index the mine that was revealed
 * @param {'reveal' | 'chord'} cause
 * @param {number} action the cell the player acted on: the clicked cell for a
 *   reveal, the chorded number for a chord
 * @param {number} now
 * @returns {Result}
 */
function lose(next, index, cause, action, now) {
  const { mines } = board(next);
  const changed = [index];
  for (let i = 0; i < mines.length; i++) {
    if (i === index) continue;
    const unflaggedMine = mines[i] === 1 && next.cells[i] === 0;
    const wrongFlag = mines[i] === 0 && next.cells[i] === 1;
    if (unflaggedMine || wrongFlag) changed.push(i);
  }
  next.cells[index] = 2;
  next.detonated = index;
  next.lossCause = cause;
  next.lossAction = action;
  next.status = 'lost';
  fold(next, now);
  return { state: next, changed: sortUnique(changed) };
}

/**
 * Checks for a win after cells were opened. Win means every safe cell is
 * revealed; flags are not consulted. On a win, remaining mines are flagged.
 * @param {Game} next mutated in place; always a fresh copy
 * @param {number[]} opened
 * @param {number} now
 * @returns {Result}
 */
function settle(next, opened, now) {
  const { mines } = board(next);
  let revealed = 0;
  for (const c of next.cells) if (c === 2) revealed++;
  const changed = opened.slice();
  if (revealed === next.cells.length - next.mineCount) {
    next.status = 'won';
    fold(next, now);
    for (let i = 0; i < mines.length; i++) {
      if (mines[i] === 1 && next.cells[i] !== 1) {
        next.cells[i] = 1;
        changed.push(i);
      }
    }
  }
  return { state: next, changed: sortUnique(changed) };
}

/** @param {number[]} xs */
function sortUnique(xs) {
  return [...new Set(xs)].sort((a, b) => a - b);
}
