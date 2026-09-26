/**
 * The win summary (takeaway, proof table) and the loss explanation. Built
 * with createElement only. The heading has tabindex="-1" so focus can move
 * to it after a win or loss.
 */

/** @typedef {import('../core/rules.js').Game} Game */
/** @typedef {import('../core/proof.js').Proof} Proof */
/** @typedef {import('../core/proof.js').LossExplanation} LossExplanation */

/** @type {Record<string, string>} */
const RULE_NAME = { opening: 'first click', flood: 'cascade', single: 'single-clue', subset: 'subset' };
const RULE_ORDER = ['opening', 'flood', 'single', 'subset'];

/**
 * @param {number} width
 * @param {number} i
 */
export function where(width, i) {
  return `Row ${Math.floor(i / width) + 1}, column ${(i % width) + 1}`;
}

/**
 * One sentence from the proof summary.
 * @param {Proof} proof
 */
export function takeaway(proof) {
  const { steps, subsetCells } = proof.summary;
  if (!proof.solved) {
    return `This board was not guaranteed. No-guess generation hit its attempt cap, so this was a random board, and the proof stopped at step ${steps} with cells it could not prove. You won the rest by luck.`;
  }
  if (steps === 0) return 'Solved by the opening alone: the first click opened every safe cell.';
  const s = steps === 1 ? '1 deduction step' : `${steps} deduction steps`;
  const sub = subsetCells === 0 ? 'none needed the subset rule'
    : subsetCells === 1 ? '1 cell needed the subset rule' : `${subsetCells} cells needed the subset rule`;
  return `Solved in ${s}; ${sub}.`;
}

/**
 * @param {Proof} proof
 * @returns {{ step: number, cells: number, rules: string }[]}
 */
export function proofRows(proof) {
  const rows = [];
  for (let s = 0; s <= proof.summary.steps; s++) {
    let cells = 0;
    const seen = new Set();
    for (let i = 0; i < proof.stepOf.length; i++) {
      if (proof.stepOf[i] !== s) continue;
      cells++;
      seen.add(proof.ruleOf[i]);
    }
    rows.push({ step: s, cells, rules: RULE_ORDER.filter((r) => seen.has(r)).map((r) => RULE_NAME[r]).join(', ') });
  }
  return rows;
}

/**
 * @param {string} tag
 * @param {string} [text]
 * @param {string} [className]
 */
function el(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

/**
 * @param {Game} game
 * @param {number[]} cells
 * @param {boolean} withNumber append each cell's number, for clue lists
 */
function cellList(game, cells, withNumber) {
  const ul = el('ul', undefined, 'cell-list');
  for (const i of cells) {
    const n = game.counts ? game.counts[i] : 0;
    ul.append(el('li', withNumber ? `${where(game.width, i)}: ${n}` : where(game.width, i)));
  }
  return ul;
}

/**
 * @param {HTMLElement} section
 * @param {HTMLElement} heading tabindex="-1"
 * @param {HTMLElement} body
 */
export function createResult(section, heading, body) {
  return {
    hide() {
      section.hidden = true;
      body.replaceChildren();
    },

    /**
     * @param {Game} game
     * @param {Proof} proof
     * @param {string} time m:ss
     */
    showWin(game, proof, time) {
      heading.textContent = `Won in ${time}`;
      const parts = [el('p', takeaway(proof), 'takeaway')];
      if (proof.solved) {
        parts.push(el('p', 'The board is tinted by the step at which the proof opened each cell: palest for the opening, deepest for the last forced cell. Focus or hover a cell to see its step.', 'note'));
      }
      const table = el('table', undefined, 'visually-hidden');
      table.append(el('caption', 'Proof steps'));
      const head = el('tr');
      for (const h of ['Step', 'Cells opened', 'Rule(s)']) {
        const th = el('th', h);
        th.setAttribute('scope', 'col');
        head.append(th);
      }
      const thead = el('thead');
      thead.append(head);
      const tbody = el('tbody');
      for (const r of proofRows(proof)) {
        const tr = el('tr');
        const th = el('th', String(r.step));
        th.setAttribute('scope', 'row');
        tr.append(th, el('td', String(r.cells)), el('td', r.rules));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      parts.push(table);
      body.replaceChildren(...parts);
      section.hidden = false;
    },

    /**
     * @param {Game} game
     * @param {LossExplanation} info
     */
    showLoss(game, info) {
      heading.textContent = 'Mine hit';
      /** @type {HTMLElement[]} */
      const parts = [];
      if (info.kind === 'chord') {
        parts.push(el('p', `The chord on ${where(game.width, info.chorded)} trusted ${info.wrongFlags.length === 1 ? 'a wrong flag' : 'wrong flags'}. A chord opens every unflagged neighbour once the flags match the number, so a misplaced flag opens a mine. Wrong flags are crossed:`));
        parts.push(cellList(game, info.wrongFlags, false));
      } else if (info.provable === 'mine') {
        parts.push(el('p', 'That cell was provably a mine from the clues shown. These numbers, outlined on the board, proved it:'));
        parts.push(cellList(game, info.clues, true));
      } else if (info.provable === 'no') {
        parts.push(el('p', `That cell could not be proved safe from the clues shown. ${where(game.width, info.safe)} was provably safe; it is now shown on the board.`));
        parts.push(el('p', 'These numbers, outlined on the board, prove it:'));
        parts.push(cellList(game, info.clues, true));
      } else {
        parts.push(el('p', 'Nothing on the board was provable at that point. This board was not guaranteed: no-guess generation hit its attempt cap, so this was a random board.'));
      }
      body.replaceChildren(...parts);
      section.hidden = false;
    },

    focusHeading() {
      heading.focus();
    },
  };
}
