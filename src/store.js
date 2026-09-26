import * as rules from './core/rules.js';
import { flood } from './core/grid.js';
import { buildProof, explainLoss } from './core/proof.js';
import { DIFFICULTIES, load, save } from './persist.js';

/**
 * The one owner of game state and persistence. Views subscribe and receive
 * the changed cell indices straight from the rules. The proof and the loss
 * explanation are derived lazily on first read after a win or loss, memoised
 * per game object, and never persisted.
 */

/** @typedef {import('./core/rules.js').Game} Game */
/** @typedef {import('./core/proof.js').Proof} Proof */
/** @typedef {import('./core/proof.js').LossExplanation} LossExplanation */
/** @typedef {import('./persist.js').Settings} Settings */
/** @typedef {import('./persist.js').Difficulty} Difficulty */
/** @typedef {import('./persist.js').StorageLike} StorageLike */

/**
 * @typedef {{ type: 'reveal' | 'flag' | 'chord', index: number }
 *   | { type: 'toggleFlagMode' | 'newGame' | 'pause' | 'resume' }
 *   | { type: 'setDifficulty', difficulty: Difficulty }} Action
 */

/** @typedef {{ settings: Settings, game: Game, flagMode: boolean }} State */
/** @typedef {{ changed: number[], rebuild: boolean, statusChanged: boolean }} Change */
/** @typedef {(state: State, change: Change) => void} Listener */

/**
 * @param {{ storage: StorageLike, now: () => number, newSeed: () => number }} deps
 */
export function createStore({ storage, now, newSeed }) {
  const loaded = load(storage, now());
  const writable = loaded.writable;
  /** @type {Settings} */
  let settings = loaded.settings;
  /** @type {Game} */
  let game = loaded.game ?? fresh(settings.difficulty);
  let flagMode = false;
  /** @type {Set<Listener>} */
  const listeners = new Set();
  /** @type {{ game: Game | null, proof: Proof | null, lossInfo: LossExplanation | null }} */
  const memo = { game: null, proof: null, lossInfo: null };

  /** @param {Difficulty} d */
  function fresh(d) {
    return rules.newGame(DIFFICULTIES[d], newSeed());
  }

  function persist() {
    if (writable) save(storage, settings, game, now());
  }

  /** @param {Change} change */
  function emit(change) {
    const state = { settings, game, flagMode };
    for (const fn of listeners) fn(state, change);
  }

  /**
   * Adopts a rules result. A no-op (no changed cells and no clock change)
   * keeps the current game object, so memoised derivations stay valid.
   * @param {{ state: Game, changed: number[] }} result
   */
  function apply(result) {
    const prev = game;
    const next = result.state;
    const clockMoved = next.resumedAt !== prev.resumedAt || next.accumulatedMs !== prev.accumulatedMs;
    if (result.changed.length === 0 && !clockMoved && next.status === prev.status) return;
    game = next;
    persist();
    emit({ changed: result.changed, rebuild: false, statusChanged: next.status !== prev.status });
  }

  /** @param {Difficulty} d */
  function restart(d) {
    const prevStatus = game.status;
    settings = { ...settings, difficulty: d };
    game = fresh(d);
    persist();
    emit({ changed: [], rebuild: true, statusChanged: game.status !== prevStatus });
  }

  function derive() {
    if (memo.game !== game) {
      memo.game = game;
      memo.proof = null;
      memo.lossInfo = null;
    }
    return memo;
  }

  return {
    /** @returns {State} */
    getState() {
      return { settings, game, flagMode };
    },

    /** @param {Action} action */
    dispatch(action) {
      switch (action.type) {
        case 'reveal': return apply(rules.reveal(game, action.index, now()));
        case 'flag': return apply(rules.flag(game, action.index));
        case 'chord': return apply(rules.chord(game, action.index, now()));
        case 'pause': return apply(rules.pause(game, now()));
        case 'resume': return apply(rules.resume(game, now()));
        case 'toggleFlagMode':
          flagMode = !flagMode;
          return emit({ changed: [], rebuild: false, statusChanged: false });
        case 'newGame': return restart(settings.difficulty);
        case 'setDifficulty':
          if (action.difficulty === settings.difficulty || !(action.difficulty in DIFFICULTIES)) return;
          return restart(action.difficulty);
        default: throw new RangeError(`unknown action ${JSON.stringify(action)}`);
      }
    },

    /** @param {Listener} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },

    /** Elapsed play time now, for the timer. */
    elapsed() {
      return rules.elapsed(game, now());
    },

    /** The proof trace of a won game, built on first read; otherwise null. */
    getProof() {
      if (game.status !== 'won' || !game.mines || game.firstClick === null) return null;
      const m = derive();
      m.proof ??= buildProof(game.width, game.height, game.mines, game.firstClick);
      return m.proof;
    },

    /** The explanation of a lost game, built on first read; otherwise null. */
    getLossInfo() {
      if (game.status !== 'lost') return null;
      const m = derive();
      m.lossInfo ??= explainLoss(game);
      return m.lossInfo;
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */

/**
 * Whether abandoning the game would lose progress beyond the first click:
 * the game is playing and has a flag, or more revealed cells than the
 * opening flood alone.
 * @param {Game} game
 */
export function hasProgress(game) {
  if (game.status !== 'playing' || game.firstClick === null || !game.counts) return false;
  let revealed = 0;
  for (const c of game.cells) {
    if (c === 1) return true;
    if (c === 2) revealed++;
  }
  const opening = flood(game.width, game.height, game.counts, new Uint8Array(game.cells.length), [game.firstClick]);
  return revealed > opening.opened.length;
}
