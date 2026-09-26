import { cellCount, neighbours } from './grid.js';
import { buildProof } from './proof.js';
import { neighbourTable } from './solver.js';

/**
 * @typedef {{ width: number, height: number, mines: number }} Config
 */

/**
 * Version of the (config, seed, firstClick) -> mines mapping. Saves store only
 * those inputs and regenerate the mines on load, so a save made under another
 * version is dropped. Bump this whenever that mapping can change: placeMines,
 * generate, mulberry32 (rng.js), deduce or neighbourTable (solver.js),
 * buildProof (proof.js), flood, neighbours or computeCounts (grid.js), or
 * GENERATE_CAP and the first-reveal path in rules.js. test/golden.test.js
 * fails when the output changes.
 */
export const GENERATOR_VERSION = 1;

/**
 * Accepts any positive-integer size. Restricting play to the three presets is
 * the UI's job, not the core's.
 * @param {Config} config
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateConfig(config) {
  const { width, height, mines } = config;
  for (const [name, v] of /** @type {const} */ ([['width', width], ['height', height], ['mines', mines]])) {
    if (!Number.isInteger(v) || v <= 0) {
      return { ok: false, error: `${name} must be a positive integer, got ${v}` };
    }
  }
  const max = cellCount(width, height) - 9;
  if (mines > max) {
    return { ok: false, error: `mines must be at most width*height - 9 (${max}), got ${mines}` };
  }
  return { ok: true };
}

/**
 * Places mines uniformly at random, excluding the first click and its
 * neighbours, using a partial Fisher-Yates over the candidate indices.
 * @param {Config} config
 * @param {number} firstClick
 * @param {() => number} rng returns floats in [0, 1)
 * @returns {Uint8Array} 1 where a mine is
 */
export function placeMines(config, firstClick, rng) {
  const v = validateConfig(config);
  if (!v.ok) throw new RangeError(v.error);
  const { width, height, mines } = config;
  const n = cellCount(width, height);
  if (!Number.isInteger(firstClick) || firstClick < 0 || firstClick >= n) {
    throw new RangeError(`firstClick out of range: ${firstClick}`);
  }

  const excluded = new Uint8Array(n);
  excluded[firstClick] = 1;
  for (const i of neighbours(width, height, firstClick)) excluded[i] = 1;

  /** @type {number[]} */
  const candidates = [];
  for (let i = 0; i < n; i++) if (!excluded[i]) candidates.push(i);
  if (mines > candidates.length) {
    throw new RangeError(`not enough candidate cells (${candidates.length}) for ${mines} mines`);
  }

  const out = new Uint8Array(n);
  const m = candidates.length;
  for (let i = 0; i < mines; i++) {
    const j = i + Math.floor(rng() * (m - i));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
    out[candidates[i]] = 1;
  }
  return out;
}

/**
 * Rerolls until the solver clears the board from the first click without
 * guessing, for at most `cap` attempts. Every attempt draws from the same rng
 * stream, so the same seed and first click give the same result.
 * @param {Config} config
 * @param {number} firstClick
 * @param {() => number} rng returns floats in [0, 1)
 * @param {number} cap maximum number of attempts, a positive integer
 * @returns {{ ok: true, mines: Uint8Array, attempts: number } | { ok: false, attempts: number }}
 */
export function generate(config, firstClick, rng, cap) {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new RangeError(`cap must be a positive integer, got ${cap}`);
  }
  // One neighbour table for every attempt of this call; the core keeps none
  // between calls.
  const table = neighbourTable(config.width, config.height);
  for (let attempt = 1; attempt <= cap; attempt++) {
    const mines = placeMines(config, firstClick, rng);
    if (buildProof(config.width, config.height, mines, firstClick, table).solved) {
      return { ok: true, mines, attempts: attempt };
    }
  }
  return { ok: false, attempts: cap };
}
