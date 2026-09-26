import { cellName, cellView } from './names.js';
import { nextFocus, activationFor } from './keys.js';

/**
 * The board: role="grid" > role="row" > role="gridcell" > <button>, built
 * once per board. Updates touch only the indices they are given. Roving
 * tabindex: exactly one button has tabindex 0.
 *
 * Activation (reveal, chord, or flag in flag mode) runs on the button's click
 * event, which covers mouse, Enter and Space. keydown handles only navigation
 * and F; handling Enter or Space there too would activate twice.
 */

/** @typedef {import('../core/rules.js').Game} Game */
/** @typedef {import('../core/proof.js').Proof} Proof */
/** @typedef {import('../core/proof.js').LossExplanation} LossExplanation */
/** @typedef {import('../store.js').Store} Store */

const SVG = 'http://www.w3.org/2000/svg';

/**
 * @param {'flag' | 'mine' | 'burst' | 'cross'} name
 */
function glyph(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `glyph glyph-${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#g-${name}`);
  svg.append(use);
  return svg;
}

/**
 * @param {HTMLElement} board the role="grid" element
 * @param {Store} store
 * @param {{ onInspect: (index: number | null) => void }} hooks
 */
export function createGrid(board, store, { onInspect }) {
  /** @type {HTMLButtonElement[]} */
  let buttons = [];
  let width = 0;
  let height = 0;
  let focusIndex = 0;

  /** @param {Game} game */
  function build(game) {
    width = game.width;
    height = game.height;
    const n = width * height;
    focusIndex = Math.floor(height / 2) * width + Math.floor(width / 2);
    buttons = new Array(n);
    const rows = [];
    for (let y = 0; y < height; y++) {
      const row = document.createElement('div');
      row.setAttribute('role', 'row');
      row.className = 'row';
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const cell = document.createElement('div');
        cell.setAttribute('role', 'gridcell');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cell';
        b.dataset.i = String(i);
        b.tabIndex = i === focusIndex ? 0 : -1;
        cell.append(b);
        row.append(cell);
        buttons[i] = b;
      }
      rows.push(row);
    }
    board.replaceChildren(...rows);
    board.setAttribute('aria-rowcount', String(height));
    board.setAttribute('aria-colcount', String(width));
    board.style.setProperty('--cols', String(width));
  }

  /**
   * @param {Game} game
   * @param {Iterable<number>} indices
   * @param {Proof | null} proof
   * @param {LossExplanation | null} lossInfo
   */
  function update(game, indices, proof, lossInfo) {
    board.dataset.status = game.status;
    for (const i of indices) {
      const b = buttons[i];
      const v = cellView(game, i, proof, lossInfo);
      b.dataset.state = v.state;
      setData(b, 'n', v.n === null || v.n === 0 ? null : String(v.n));
      setData(b, 'band', v.band === null ? null : String(v.band));
      setData(b, 'clue', v.clue ? '' : null);
      b.setAttribute('aria-label', cellName(game, i, proof, lossInfo));
      if (v.state === 'flagged') b.replaceChildren(glyph('flag'));
      else if (v.state === 'mine') b.replaceChildren(glyph('mine'));
      else if (v.state === 'detonated') b.replaceChildren(glyph('burst'));
      else if (v.state === 'wrong-flag') b.replaceChildren(glyph('flag'), glyph('cross'));
      else b.textContent = v.text;
    }
  }

  /**
   * @param {HTMLElement} el
   * @param {string} key
   * @param {string | null} value
   */
  function setData(el, key, value) {
    if (value === null) delete el.dataset[key];
    else el.dataset[key] = value;
  }

  /** @param {number} i */
  function focusCell(i) {
    buttons[focusIndex].tabIndex = -1;
    focusIndex = i;
    const b = buttons[i];
    b.tabIndex = 0;
    b.focus({ preventScroll: true });
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** @param {EventTarget | null} target */
  function indexOf(target) {
    const b = target instanceof Element ? target.closest('button.cell') : null;
    return b instanceof HTMLButtonElement && b.dataset.i !== undefined ? Number(b.dataset.i) : null;
  }

  board.addEventListener('click', (e) => {
    const i = indexOf(e.target);
    if (i === null) return;
    if (i !== focusIndex) {
      buttons[focusIndex].tabIndex = -1;
      focusIndex = i;
      buttons[i].tabIndex = 0;
    }
    const { game, flagMode } = store.getState();
    store.dispatch({ type: activationFor(game, i, flagMode), index: i });
  });

  board.addEventListener('contextmenu', (e) => {
    const i = indexOf(e.target);
    if (i === null) return;
    e.preventDefault();
    store.dispatch({ type: 'flag', index: i });
  });

  board.addEventListener('keydown', (e) => {
    const i = indexOf(e.target);
    if (i === null || e.altKey || e.metaKey) return;
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey) {
      e.preventDefault();
      store.dispatch({ type: 'flag', index: i });
      return;
    }
    const next = nextFocus(i, e.key, e.ctrlKey, width, height);
    if (next === null) return;
    e.preventDefault();
    focusCell(next);
  });

  board.addEventListener('focusin', (e) => onInspect(indexOf(e.target)));
  board.addEventListener('mouseover', (e) => {
    const i = indexOf(e.target);
    if (i !== null) onInspect(i);
  });

  return {
    build,
    update,
    /**
     * @param {Game} game
     * @param {Proof | null} proof
     * @param {LossExplanation | null} lossInfo
     */
    updateAll(game, proof, lossInfo) {
      update(game, buttons.keys(), proof, lossInfo);
    },
  };
}
