import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bandOf, buildProof, explainLoss } from '../src/core/proof.js';
import { computeCounts } from '../src/core/grid.js';
import { nextFocus, activationFor } from '../src/view/keys.js';
import { cellName, cellView } from '../src/view/names.js';

/** @typedef {import('../src/core/rules.js').Game} Game */

// ---- bandOf ----

test('bandOf maps step 0 to band 0', () => {
  assert.equal(bandOf(0, 12), 0);
});

test('bandOf maps the last step to band 7', () => {
  assert.equal(bandOf(12, 12), 7);
  assert.equal(bandOf(1, 1), 7);
});

test('bandOf is monotonic over 0..maxStep', () => {
  for (const max of [1, 2, 3, 7, 8, 13, 40]) {
    let prev = -1;
    for (let s = 0; s <= max; s++) {
      const b = bandOf(s, max);
      assert.ok(b >= prev && b >= 0 && b <= 7, `max ${max} step ${s} gave ${b} after ${prev}`);
      prev = b;
    }
  }
});

test('bandOf with maxStep 0 gives band 0', () => {
  assert.equal(bandOf(0, 0), 0);
});

// ---- nextFocus (5 wide, 4 high) ----

const W = 5;
const H = 4;

test('ArrowLeft at the left edge clamps and never wraps to the previous row', () => {
  assert.equal(nextFocus(5, 'ArrowLeft', false, W, H), 5);
  assert.equal(nextFocus(6, 'ArrowLeft', false, W, H), 5);
});

test('ArrowRight at the right edge clamps and never wraps to the next row', () => {
  assert.equal(nextFocus(9, 'ArrowRight', false, W, H), 9);
  assert.equal(nextFocus(8, 'ArrowRight', false, W, H), 9);
});

test('ArrowUp at the top edge clamps', () => {
  assert.equal(nextFocus(2, 'ArrowUp', false, W, H), 2);
  assert.equal(nextFocus(7, 'ArrowUp', false, W, H), 2);
});

test('ArrowDown at the bottom edge clamps', () => {
  assert.equal(nextFocus(17, 'ArrowDown', false, W, H), 17);
  assert.equal(nextFocus(12, 'ArrowDown', false, W, H), 17);
});

test('Home and End stay within the row', () => {
  assert.equal(nextFocus(12, 'Home', false, W, H), 10);
  assert.equal(nextFocus(12, 'End', false, W, H), 14);
  assert.equal(nextFocus(10, 'Home', false, W, H), 10);
  assert.equal(nextFocus(14, 'End', false, W, H), 14);
});

test('Ctrl+Home goes to the first cell and Ctrl+End to the last', () => {
  assert.equal(nextFocus(12, 'Home', true, W, H), 0);
  assert.equal(nextFocus(12, 'End', true, W, H), 19);
});

test('an unknown key returns null', () => {
  assert.equal(nextFocus(12, 'x', false, W, H), null);
  assert.equal(nextFocus(12, 'Enter', false, W, H), null);
  assert.equal(nextFocus(12, ' ', false, W, H), null);
});

// ---- boards for names ----

/**
 * 4x3, mines at 3 and 11:
 *   . . . M
 *   . . . .
 *   . . . M
 * @param {Partial<Game>} over
 * @returns {Game}
 */
function board(over = {}) {
  const width = 4;
  const height = 3;
  const mines = new Uint8Array(12);
  mines[3] = 1;
  mines[11] = 1;
  return {
    width, height, mineCount: 2, seed: 0, firstClick: 0, status: 'playing',
    detonated: null, lossCause: null, lossAction: null,
    cells: new Uint8Array(12), mines, counts: computeCounts(width, height, mines),
    accumulatedMs: 0, resumedAt: null, ...over,
  };
}

test('activationFor chords a revealed cell in either mode', () => {
  const g = board();
  g.cells[2] = 2;
  assert.equal(activationFor(g, 2, false), 'chord');
  assert.equal(activationFor(g, 2, true), 'chord');
});

test('activationFor reveals a covered cell, or flags it in flag mode', () => {
  const g = board();
  assert.equal(activationFor(g, 0, false), 'reveal');
  assert.equal(activationFor(g, 0, true), 'flag');
  g.cells[0] = 1;
  assert.equal(activationFor(g, 0, true), 'flag');
});

// ---- cellName ----

test('cellName names a covered cell with 1-based row and column', () => {
  assert.equal(cellName(board(), 0, null, null), 'Row 1, column 1, covered');
  assert.equal(cellName(board(), 6, null, null), 'Row 2, column 3, covered');
});

test('cellName uses 1-based indices at the last row and column', () => {
  assert.equal(cellName(board(), 11, null, null), 'Row 3, column 4, covered');
});

test('cellName names a flagged cell', () => {
  const g = board();
  g.cells[5] = 1;
  assert.equal(cellName(g, 5, null, null), 'Row 2, column 2, flagged');
});

test('cellName names an empty revealed cell', () => {
  const g = board();
  g.cells[0] = 2;
  assert.equal(cellName(g, 0, null, null), 'Row 1, column 1, empty');
});

test('cellName uses the singular for 1 adjacent mine', () => {
  const g = board();
  g.cells[2] = 2;
  assert.equal(cellName(g, 2, null, null), 'Row 1, column 3, 1 adjacent mine');
});

test('cellName uses the plural for 2 adjacent mines', () => {
  const g = board();
  g.cells[7] = 2;
  assert.equal(cellName(g, 7, null, null), 'Row 2, column 4, 2 adjacent mines');
});

/** A won 4x3 board with its proof. */
function won() {
  const g = board({ status: 'won' });
  for (let i = 0; i < 12; i++) g.cells[i] = g.mines?.[i] ? 1 : 2;
  const proof = buildProof(4, 3, /** @type {Uint8Array} */ (g.mines), 0);
  return { g, proof };
}

test('cellName after a win names the opening cell as opened by first click', () => {
  const { g, proof } = won();
  assert.equal(proof.ruleOf[0], 'opening');
  assert.equal(cellName(g, 0, proof, null), 'Row 1, column 1, empty, opened by first click');
});

test('cellName after a win names a cascade cell with its step', () => {
  const { g, proof } = won();
  assert.equal(proof.ruleOf[1], 'flood');
  assert.equal(cellName(g, 1, proof, null), 'Row 1, column 2, empty, opened at step 0 by cascade');
});

test('cellName after a win names a single-clue cell with its step', () => {
  const g = board({ status: 'won' });
  const proof = buildProof(4, 3, /** @type {Uint8Array} */ (g.mines), 0);
  const proof2 = { ...proof, ruleOf: proof.ruleOf.slice(), stepOf: proof.stepOf.slice() };
  proof2.ruleOf[7] = 'single';
  proof2.stepOf[7] = 3;
  for (let i = 0; i < 12; i++) g.cells[i] = g.mines?.[i] ? 1 : 2;
  assert.equal(cellName(g, 7, proof2, null), 'Row 2, column 4, 2 adjacent mines, proved at step 3 by single-clue rule');
});

test('cellName after a win names a subset cell with its step', () => {
  const { g, proof } = won();
  const p = { ...proof, ruleOf: proof.ruleOf.slice(), stepOf: proof.stepOf.slice() };
  p.ruleOf[2] = 'subset';
  p.stepOf[2] = 4;
  assert.equal(cellName(g, 2, p, null), 'Row 1, column 3, 1 adjacent mine, proved at step 4 by subset rule');
});

test('cellName after a win names an auto-flagged mine as flagged', () => {
  const { g, proof } = won();
  assert.equal(cellName(g, 3, proof, null), 'Row 1, column 4, flagged');
});

/**
 * After the opening (every cell but 3, 7 and 11), the player flags 7 (not a
 * mine) and clicks 3, which the subset rule proves is a mine.
 */
function lost() {
  const g = board({ status: 'lost', detonated: 3, lossCause: 'reveal', lossAction: 3 });
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) g.cells[i] = 2;
  g.cells[3] = 2;
  g.cells[7] = 1;
  const info = explainLoss(g);
  assert.equal(info.kind === 'reveal' && info.provable, 'mine', 'precondition: 3 was provably a mine');
  return { g, info };
}

test('cellName after a loss names an unflagged mine as mine', () => {
  const { g, info } = lost();
  assert.equal(cellName(g, 11, null, info), 'Row 3, column 4, mine');
});

test('cellName after a loss names the detonated mine', () => {
  const { g, info } = lost();
  assert.equal(cellName(g, 3, null, info), 'Row 1, column 4, mine, detonated');
});

test('cellName after a loss names a wrong flag', () => {
  const { g, info } = lost();
  assert.equal(cellName(g, 7, null, info), 'Row 2, column 4, flagged, not a mine');
});

test('cellName after a loss names the provably safe cell as shown after loss', () => {
  const g = board({ status: 'lost', detonated: 3, lossCause: 'reveal', lossAction: 3 });
  g.cells[3] = 2;
  const info = { kind: /** @type {const} */ ('reveal'), provable: /** @type {const} */ ('no'), safe: 7, clues: [2] };
  assert.equal(cellName(g, 7, null, info), 'Row 2, column 4, 2 adjacent mines, provably safe, shown after loss');
});

// ---- cellView ----

test('cellView gives a proof band to revealed cells on a won board and none to mines', () => {
  const { g, proof } = won();
  assert.equal(cellView(g, 0, proof, null).band, 0);
  assert.equal(cellView(g, 3, proof, null).band, null);
  assert.equal(cellView(g, 3, proof, null).state, 'flagged');
});

test('cellView gives no band to a revealed cell the proof never reached', () => {
  const { g, proof } = won();
  const p = { ...proof, stepOf: proof.stepOf.slice() };
  p.stepOf[2] = -1;
  assert.equal(cellView(g, 2, p, null).band, null);
});

test('cellView after a loss shows mines, the detonated mine and wrong flags', () => {
  const { g, info } = lost();
  assert.equal(cellView(g, 3, null, info).state, 'detonated');
  assert.equal(cellView(g, 11, null, info).state, 'mine');
  assert.equal(cellView(g, 7, null, info).state, 'wrong-flag');
  assert.equal(cellView(g, 6, null, info).state, 'revealed');
});

test('cellView after a provable-mine loss marks the clue cells', () => {
  const { g, info } = lost();
  const clues = info.kind === 'reveal' && info.provable !== 'none' ? info.clues : [];
  assert.ok(clues.length > 0);
  for (let i = 0; i < 12; i++) {
    assert.equal(cellView(g, i, null, info).clue, clues.includes(i), `cell ${i}`);
  }
});

test('cellView shows the provably safe cell as revealed paper with its digit', () => {
  const g = board({ status: 'lost', detonated: 3, lossCause: 'reveal', lossAction: 3 });
  g.cells[3] = 2;
  const info = { kind: /** @type {const} */ ('reveal'), provable: /** @type {const} */ ('no'), safe: 7, clues: [2] };
  const v = cellView(g, 7, null, info);
  assert.equal(v.state, 'safe-shown');
  assert.equal(v.n, 2);
  assert.equal(v.text, '2');
  assert.equal(cellView(g, 2, null, info).clue, true);
});

// ---- no innerHTML ----

/** @param {string} dir @returns {string[]} */
function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('no file under src/ and not index.html uses innerHTML, outerHTML or insertAdjacentHTML', () => {
  const root = join(import.meta.dirname, '..');
  const targets = [...files(join(root, 'src')).filter((f) => f.endsWith('.js')), join(root, 'index.html')];
  for (const f of targets) {
    const hits = readFileSync(f, 'utf8').match(/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/g) ?? [];
    assert.deepEqual(hits, [], `${f} uses ${hits.join(', ')}`);
  }
});

test('the mine and detonated glyphs differ in shape, not only colour: no diagonal spokes on the mine, a hollow burst', () => {
  // Regression: at 26px a mine drawn as a circle with eight spokes and a
  // solid sixteen-point burst both read as the same spiky star, so only the
  // red cell told the detonated mine apart (seen in the phase 3b browser check).
  const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
  const symbol = (/** @type {string} */ id) => {
    const m = html.match(new RegExp(String.raw`<symbol id="${id}"[\s\S]*?</symbol>`));
    assert.ok(m, `sprite has #${id}`);
    return m[0];
  };
  const mine = symbol('g-mine');
  const burst = symbol('g-burst');
  for (const [, d] of mine.matchAll(/ d="([^"]*)"/g)) {
    assert.match(d, /^[Mhv\d.\s-]+$/, `mine path "${d}" may only use M, h and v, so no line is diagonal`);
  }
  assert.match(burst, /fill-rule="evenodd"/, 'burst has a hollow centre');
  for (const id of ['g-flag', 'g-mine', 'g-burst', 'g-cross']) assert.match(symbol(id), /currentColor/);
});
