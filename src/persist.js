import { newGame, reveal, elapsed } from './core/rules.js';
import { GENERATOR_VERSION } from './core/generate.js';

/**
 * Versioned persistence under one localStorage key. Only inputs are stored:
 * mines, counts, the proof and the loss explanation are derived. Mines are
 * regenerated from (config, seed, firstClick) by replaying the first reveal,
 * which is exactly the path rules.reveal took (generate, then the fallback).
 * Every storage call is inside try/catch.
 */

export const KEY = 'lemma';
export const VERSION = 1;

/** @typedef {import('./core/rules.js').Game} Game */
/** @typedef {'beginner' | 'intermediate' | 'expert'} Difficulty */
/** @typedef {{ difficulty: Difficulty }} Settings */
/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} StorageLike */

/** @type {Readonly<Record<Difficulty, Readonly<{ width: number, height: number, mines: number }>>>} */
export const DIFFICULTIES = Object.freeze({
  beginner: Object.freeze({ width: 9, height: 9, mines: 10 }),
  intermediate: Object.freeze({ width: 16, height: 16, mines: 40 }),
  expert: Object.freeze({ width: 30, height: 16, mines: 99 }),
});

/**
 * @typedef {object} SavedGame
 * @property {number} width
 * @property {number} height
 * @property {number} mineCount
 * @property {number} seed
 * @property {number | null} firstClick
 * @property {Game['status']} status
 * @property {number | null} detonated
 * @property {Game['lossCause']} lossCause
 * @property {number | null} lossAction
 * @property {number} gen GENERATOR_VERSION at save time
 * @property {string} cells one of 0/1/2 per cell
 * @property {number} accumulatedMs elapsed(game, now) at save time
 */

/** @typedef {{ version: number, settings: Settings, game?: SavedGame | null }} Payload */

/** @returns {Settings} */
export function defaultSettings() {
  return { difficulty: 'beginner' };
}

/** @param {unknown} d @returns {d is Difficulty} */
export function isDifficulty(d) {
  return d === 'beginner' || d === 'intermediate' || d === 'expert';
}

/**
 * Brings a parsed payload to the current version. Version 1 is current and
 * passes through. A higher integer version is an unknown future version: the
 * caller runs on defaults in memory and never writes, so the newer save is
 * not overwritten. Anything else is invalid and falls back to defaults.
 * @param {unknown} raw
 * @returns {{ ok: true, payload: any } | { ok: false, future: boolean }}
 */
export function migrate(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, future: false };
  const version = /** @type {{ version?: unknown }} */ (raw).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, future: false };
  }
  if (version > VERSION) return { ok: false, future: true };
  return { ok: true, payload: raw };
}

/**
 * @param {StorageLike} storage
 * @param {number} now the time a loaded 'playing' game resumes its clock from
 * @returns {{ settings: Settings, game: Game | null, writable: boolean }}
 */
export function load(storage, now) {
  const fallback = { settings: defaultSettings(), game: null, writable: true };
  let text;
  try {
    text = storage.getItem(KEY);
  } catch {
    return fallback;
  }
  if (text === null) return fallback;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return fallback;
  }
  const m = migrate(raw);
  if (!m.ok) return { ...fallback, writable: !m.future };
  const d = m.payload.settings?.difficulty;
  const settings = isDifficulty(d) ? { difficulty: d } : defaultSettings();
  const game = m.payload.game ? restoreGame(m.payload.game, settings.difficulty, now) : null;
  return { settings, game, writable: true };
}

/**
 * @param {Settings} settings
 * @param {Game} game
 * @param {number} now
 * @returns {Payload}
 */
export function serialize(settings, game, now) {
  return {
    version: VERSION,
    settings: { difficulty: settings.difficulty },
    game: {
      width: game.width,
      height: game.height,
      mineCount: game.mineCount,
      seed: game.seed,
      firstClick: game.firstClick,
      status: game.status,
      detonated: game.detonated,
      lossCause: game.lossCause,
      lossAction: game.lossAction,
      gen: GENERATOR_VERSION,
      cells: game.cells.join(''),
      accumulatedMs: elapsed(game, now),
    },
  };
}

/**
 * @param {StorageLike} storage
 * @param {Settings} settings
 * @param {Game} game
 * @param {number} now
 * @returns {boolean} whether the write succeeded
 */
export function save(storage, settings, game, now) {
  try {
    storage.setItem(KEY, JSON.stringify(serialize(settings, game, now)));
    return true;
  } catch {
    return false;
  }
}

/** @param {unknown} v @param {number} n */
function isIndex(v, n) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;
}

/**
 * Validates a saved game and rebuilds it, or returns null to drop it.
 * @param {any} g
 * @param {Difficulty} difficulty the saved settings; the game must match
 * @param {number} now
 * @returns {Game | null}
 */
export function restoreGame(g, difficulty, now) {
  if (g === null || typeof g !== 'object') return null;
  const config = DIFFICULTIES[difficulty];
  if (g.width !== config.width || g.height !== config.height || g.mineCount !== config.mines) return null;
  if (g.gen !== GENERATOR_VERSION) return null;
  if (!Number.isInteger(g.seed) || g.seed < 0 || g.seed > 0xffffffff) return null;
  const n = config.width * config.height;
  if (typeof g.cells !== 'string' || g.cells.length !== n || !/^[012]*$/.test(g.cells)) return null;
  if (typeof g.accumulatedMs !== 'number' || !Number.isFinite(g.accumulatedMs) || g.accumulatedMs < 0) return null;
  const cells = Uint8Array.from(g.cells, (ch) => Number(ch));

  const base = newGame(config, g.seed);
  if (g.status === 'ready') {
    if (g.firstClick !== null || g.detonated !== null || g.lossCause !== null || g.lossAction !== null) return null;
    if (cells.includes(2) || g.accumulatedMs !== 0) return null;
    return { ...base, cells };
  }
  if (g.status !== 'playing' && g.status !== 'won' && g.status !== 'lost') return null;
  if (!isIndex(g.firstClick, n) || cells[g.firstClick] !== 2) return null;

  // Replay the first reveal: the same path, so the same mines.
  const { mines, counts } = reveal(base, g.firstClick, 0).state;
  if (!mines || !counts) return null;

  let safeCovered = 0;
  for (let i = 0; i < n; i++) {
    if (mines[i] && cells[i] === 2 && i !== g.detonated) return null;
    if (!mines[i] && cells[i] !== 2) safeCovered++;
  }

  if (g.status === 'lost') {
    if (!isIndex(g.detonated, n) || !mines[g.detonated] || cells[g.detonated] !== 2) return null;
    if (g.lossCause !== 'reveal' && g.lossCause !== 'chord') return null;
    if (!isIndex(g.lossAction, n)) return null;
  } else {
    if (g.detonated !== null || g.lossCause !== null || g.lossAction !== null) return null;
    if (g.status === 'playing' && safeCovered === 0) return null;
    if (g.status === 'won') {
      if (safeCovered !== 0) return null;
      for (let i = 0; i < n; i++) if (mines[i] && cells[i] !== 1) return null;
    }
  }

  return {
    ...base,
    firstClick: g.firstClick,
    status: g.status,
    detonated: g.detonated,
    lossCause: g.lossCause,
    lossAction: g.lossAction,
    cells,
    mines,
    counts,
    accumulatedMs: g.accumulatedMs,
    resumedAt: g.status === 'playing' ? now : null,
  };
}
