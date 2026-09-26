import { counter } from '../core/rules.js';

/**
 * Mine counter, timer, Flag mode toggle, difficulty and New game. The timer
 * is role="timer" (implicitly aria-live="off") and is never inside a live
 * region.
 */

/** @typedef {import('../store.js').State} State */
/** @typedef {import('../persist.js').Difficulty} Difficulty */

/** Formats an integer with a real minus sign (U+2212). @param {number} n */
export function signed(n) {
  return n < 0 ? `−${-n}` : String(n);
}

/** m:ss from milliseconds. @param {number} ms */
export function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * @param {{
 *   counter: HTMLElement, timer: HTMLElement, flagMode: HTMLButtonElement,
 *   difficulty: HTMLFieldSetElement, newGame: HTMLButtonElement,
 * }} els
 * @param {{
 *   onFlagMode: () => void, onNewGame: () => void,
 *   onDifficulty: (d: Difficulty) => void,
 * }} on
 */
export function createHud(els, on) {
  els.flagMode.addEventListener('click', on.onFlagMode);
  els.newGame.addEventListener('click', on.onNewGame);
  els.difficulty.addEventListener('change', (e) => {
    const input = e.target;
    if (input instanceof HTMLInputElement && input.name === 'difficulty') {
      on.onDifficulty(/** @type {Difficulty} */ (input.value));
    }
  });

  return {
    /** @param {State} state */
    update(state) {
      els.counter.textContent = signed(counter(state.game));
      els.flagMode.setAttribute('aria-pressed', String(state.flagMode));
      this.selectDifficulty(state.settings.difficulty);
    },
    /** @param {Difficulty} d */
    selectDifficulty(d) {
      for (const input of els.difficulty.querySelectorAll('input[name="difficulty"]')) {
        if (input instanceof HTMLInputElement) input.checked = input.value === d;
      }
    },
    /** @param {number} ms */
    setTime(ms) {
      const text = clock(ms);
      if (els.timer.textContent !== text) els.timer.textContent = text;
    },
  };
}
