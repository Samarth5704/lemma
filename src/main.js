import { createStore, hasProgress } from './store.js';
import { counter } from './core/rules.js';
import { createGrid } from './view/grid.js';
import { createHud, signed, clock } from './view/hud.js';
import { createResult, where } from './view/result.js';

/** @typedef {import('./persist.js').Difficulty} Difficulty */
/** @typedef {import('./persist.js').StorageLike} StorageLike */

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
function byId(id, type) {
  const e = document.getElementById(id);
  if (!(e instanceof type)) throw new Error(`#${id} is missing or not a ${type.name}`);
  return e;
}

/** window.localStorage, or a stub whose calls throw if even reading it throws. @returns {StorageLike} */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    const fail = () => { throw new Error('storage unavailable'); };
    return { getItem: fail, setItem: fail };
  }
}

function newSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

const store = createStore({ storage: browserStorage(), now: () => performance.now(), newSeed });

const DIFFICULTY_NAME = /** @type {Record<Difficulty, string>} */ ({
  beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert',
});

// ---- live region ----

const live = byId('live', HTMLElement);
/** @type {number | undefined} */
let liveTimer;
/** @param {string} text */
function announce(text) {
  // Clear first so a repeated message ("Flagged. 9 mines left.") is re-read.
  live.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { live.textContent = text; }, 60);
}

/** @param {number} n */
function minesLeft(n) {
  return `${signed(n)} ${n === 1 ? 'mine' : 'mines'} left.`;
}

// ---- confirm dialog ----

const dialog = byId('confirm', HTMLDialogElement);
const dialogText = byId('confirm-text', HTMLElement);
const dialogOk = byId('confirm-ok', HTMLButtonElement);
/** @type {{ run: () => void, returnTo: () => HTMLElement, cancel: () => void } | null} */
let pending = null;

/**
 * @param {string} question
 * @param {string} okLabel
 * @param {() => HTMLElement} returnTo called after the dialog closes; focus goes there
 * @param {() => void} run
 * @param {() => void} [cancel]
 */
function confirmThen(question, okLabel, returnTo, run, cancel = () => {}) {
  dialogText.textContent = question;
  dialogOk.textContent = okLabel;
  dialog.returnValue = '';
  pending = { run, returnTo, cancel };
  dialog.showModal();
}

dialog.addEventListener('close', () => {
  const p = pending;
  pending = null;
  if (!p) return;
  if (dialog.returnValue === 'confirm') p.run();
  else p.cancel();
  p.returnTo().focus();
});

/** The checked difficulty radio: focus returns there, not to an unchecked one. */
function checkedDifficulty() {
  const input = byId('difficulty', HTMLFieldSetElement).querySelector('input[name="difficulty"]:checked');
  return input instanceof HTMLInputElement ? input : newGameButton;
}

// ---- views ----

const inspector = byId('inspector', HTMLElement);
const grid = createGrid(byId('board', HTMLElement), store, { onInspect: inspect });
const result = createResult(byId('result', HTMLElement), byId('result-heading', HTMLElement), byId('result-body', HTMLElement));
const newGameButton = byId('new-game', HTMLButtonElement);

const hud = createHud({
  counter: byId('counter', HTMLElement),
  timer: byId('timer', HTMLElement),
  flagMode: byId('flag-mode', HTMLButtonElement),
  difficulty: byId('difficulty', HTMLFieldSetElement),
  newGame: newGameButton,
}, {
  onFlagMode() {
    store.dispatch({ type: 'toggleFlagMode' });
  },
  onNewGame() {
    if (hasProgress(store.getState().game)) {
      confirmThen('Start a new game and abandon this one?', 'New game', () => newGameButton,
        () => store.dispatch({ type: 'newGame' }));
    } else {
      store.dispatch({ type: 'newGame' });
    }
  },
  onDifficulty(d) {
    const current = store.getState().settings.difficulty;
    if (hasProgress(store.getState().game)) {
      // Keep the old choice checked until confirmed.
      hud.selectDifficulty(current);
      confirmThen(`Switch to ${DIFFICULTY_NAME[d]} and abandon this game?`, `Switch to ${DIFFICULTY_NAME[d]}`, checkedDifficulty,
        () => store.dispatch({ type: 'setDifficulty', difficulty: d }),
        () => hud.selectDifficulty(current));
    } else {
      store.dispatch({ type: 'setDifficulty', difficulty: d });
    }
  },
});

const RULE_LABEL = { opening: 'first click', flood: 'cascade', single: 'single-clue rule', subset: 'subset rule' };

/** Inspector line on a won board. @param {number | null} i */
function inspect(i) {
  const { game } = store.getState();
  const proof = store.getProof();
  if (i === null || !proof) return;
  let text;
  if (game.mines?.[i]) text = 'mine';
  else if (proof.stepOf[i] < 0) text = 'not reached by the proof';
  else text = `step ${proof.stepOf[i]}, ${RULE_LABEL[proof.ruleOf[i] ?? 'opening']}`;
  inspector.textContent = `${where(game.width, i)}: ${text}`;
}

/**
 * Shows the result for a finished game.
 * @param {boolean} moveFocus false on page load, true when the game just ended
 */
function showOutcome(moveFocus) {
  const { game } = store.getState();
  if (game.status === 'won') {
    const proof = /** @type {import('./core/proof.js').Proof} */ (store.getProof());
    grid.updateAll(game, proof, null);
    result.showWin(game, proof, clock(store.elapsed()));
    inspector.hidden = false;
    inspector.textContent = 'Focus or hover a cell to see the step that proved it.';
  } else if (game.status === 'lost') {
    const info = /** @type {import('./core/proof.js').LossExplanation} */ (store.getLossInfo());
    grid.updateAll(game, null, info);
    result.showLoss(game, info);
  } else {
    return;
  }
  if (moveFocus) result.focusHeading();
}

function render() {
  const state = store.getState();
  grid.build(state.game);
  grid.updateAll(state.game, null, null);
  hud.update(state);
  hud.setTime(store.elapsed());
  result.hide();
  inspector.hidden = true;
  inspector.textContent = '';
}

/** @type {Uint8Array} */
let prevCells = store.getState().game.cells;

store.subscribe((state, { changed, rebuild, statusChanged }) => {
  const { game } = state;
  hud.update(state);
  hud.setTime(store.elapsed());
  if (rebuild) {
    render();
    prevCells = game.cells;
    return;
  }
  grid.update(game, changed, null, null);

  if (statusChanged && (game.status === 'won' || game.status === 'lost')) {
    showOutcome(true);
    announce(game.status === 'won'
      ? `You won in ${clock(store.elapsed())}. ${document.querySelector('#result-body .takeaway')?.textContent ?? ''}`
      : 'Mine hit. You lost. The explanation follows the board.');
  } else if (changed.length > 0) {
    const opened = changed.filter((i) => game.cells[i] === 2 && prevCells[i] !== 2).length;
    const flagChanged = changed.length === 1 && (game.cells[changed[0]] === 1) !== (prevCells[changed[0]] === 1);
    if (flagChanged) {
      announce(`${game.cells[changed[0]] === 1 ? 'Flagged' : 'Flag removed'}. ${minesLeft(counter(game))}`);
    } else if (opened > 1) {
      announce(`Opened ${opened} cells`);
    }
  }
  prevCells = game.cells;
});

// ---- clock and page lifecycle ----

window.setInterval(() => hud.setTime(store.elapsed()), 250);

document.addEventListener('visibilitychange', () => {
  store.dispatch({ type: document.hidden ? 'pause' : 'resume' });
});
// A pause folds the running time into accumulatedMs and saves.
window.addEventListener('pagehide', () => store.dispatch({ type: 'pause' }));
window.addEventListener('pageshow', (e) => {
  if (e.persisted && !document.hidden) store.dispatch({ type: 'resume' });
});

render();
showOutcome(false);
if (document.hidden) store.dispatch({ type: 'pause' });
