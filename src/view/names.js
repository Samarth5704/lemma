import { bandOf } from '../core/proof.js';

/**
 * Pure per-cell view model and accessible name. No DOM here, so node tests
 * import it directly.
 */

/** @typedef {import('../core/rules.js').Game} Game */
/** @typedef {import('../core/proof.js').Proof} Proof */
/** @typedef {import('../core/proof.js').LossExplanation} LossExplanation */

/**
 * @typedef {'covered' | 'flagged' | 'revealed' | 'mine' | 'detonated' | 'wrong-flag' | 'safe-shown'} CellState
 */

/**
 * @typedef {object} CellView
 * @property {CellState} state
 * @property {number | null} n the digit's count for revealed and safe-shown cells
 * @property {number | null} band proof-map band on a won board; null elsewhere
 *   and for cells the proof never reached
 * @property {boolean} clue a number cited by the loss explanation
 * @property {string} text the digit, or '' for empty and non-revealed cells
 */

/** @type {Record<string, string>} */
const RULE_TEXT = {
  single: 'single-clue rule',
  subset: 'subset rule',
};

/**
 * @param {Game} game
 * @param {number} index
 * @param {Proof | null} proof only read on a won board
 * @param {LossExplanation | null} lossInfo only read on a lost board
 * @returns {CellView}
 */
export function cellView(game, index, proof, lossInfo) {
  const c = game.cells[index];
  const count = game.counts ? game.counts[index] : 0;
  /** @type {CellState} */
  let state = c === 2 ? 'revealed' : c === 1 ? 'flagged' : 'covered';
  let clue = false;

  if (game.status === 'lost' && game.mines) {
    const mine = game.mines[index] === 1;
    if (index === game.detonated) state = 'detonated';
    else if (mine && c === 0) state = 'mine';
    else if (!mine && c === 1) state = 'wrong-flag';
    else if (lossInfo?.kind === 'reveal' && lossInfo.provable === 'no' && lossInfo.safe === index) {
      state = 'safe-shown';
    }
    if (lossInfo?.kind === 'reveal' && lossInfo.provable !== 'none') {
      clue = lossInfo.clues.includes(index);
    }
  }

  const showsDigit = state === 'revealed' || state === 'safe-shown';
  let band = null;
  if (game.status === 'won' && proof && state === 'revealed' && proof.stepOf[index] >= 0) {
    band = bandOf(proof.stepOf[index], proof.summary.steps);
  }
  return {
    state,
    n: showsDigit ? count : null,
    band,
    clue,
    text: showsDigit && count > 0 ? String(count) : '',
  };
}

/**
 * The accessible name, 1-based: "Row 3, column 5, 2 adjacent mines".
 * @param {Game} game
 * @param {number} index
 * @param {Proof | null} proof
 * @param {LossExplanation | null} lossInfo
 * @returns {string}
 */
export function cellName(game, index, proof, lossInfo) {
  const x = index % game.width;
  const y = Math.floor(index / game.width);
  const where = `Row ${y + 1}, column ${x + 1}`;
  const v = cellView(game, index, proof, lossInfo);
  switch (v.state) {
    case 'covered': return `${where}, covered`;
    case 'flagged': return `${where}, flagged`;
    case 'mine': return `${where}, mine`;
    case 'detonated': return `${where}, mine, detonated`;
    case 'wrong-flag': return `${where}, flagged, not a mine`;
    case 'safe-shown': return `${where}, ${countText(v.n ?? 0)}, provably safe, shown after loss`;
    default: break;
  }
  const base = `${where}, ${countText(v.n ?? 0)}`;
  if (game.status !== 'won' || !proof) return base;
  const how = proofText(proof, index);
  return how ? `${base}, ${how}` : base;
}

/** @param {number} n */
function countText(n) {
  if (n === 0) return 'empty';
  return n === 1 ? '1 adjacent mine' : `${n} adjacent mines`;
}

/**
 * How the proof reached a cell, or '' if it never did.
 * @param {Proof} proof
 * @param {number} index
 */
export function proofText(proof, index) {
  const step = proof.stepOf[index];
  const rule = proof.ruleOf[index];
  if (step < 0 || rule === null) return '';
  if (rule === 'opening') return 'opened by first click';
  if (rule === 'flood') return `opened at step ${step} by cascade`;
  return `proved at step ${step} by ${RULE_TEXT[rule]}`;
}
