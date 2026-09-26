import { computeCounts, flood, neighbours, toXY } from './grid.js';
import { deduce, neighbourTable, visibleClues } from './solver.js';

/** @typedef {'opening' | 'single' | 'subset' | 'flood'} ProofRule */

/**
 * @typedef {object} Proof
 * @property {boolean} solved every safe cell was revealed
 * @property {Int16Array} stepOf the step that revealed each cell; -1 for
 *   mines and for cells never reached
 * @property {(ProofRule | null)[]} ruleOf why each cell was revealed; null
 *   for mines and unreached cells
 * @property {(number[] | null)[]} cluesOf for 'single' and 'subset', the
 *   numbers used (ascending); for 'flood', a one-element array holding the
 *   zero that opened the cell; for 'opening', empty; null where ruleOf is null
 * @property {{ steps: number, singleCells: number, subsetCells: number, floodCells: number }} summary
 *   steps is the last step reached (0 if the opening was all there was)
 */

/**
 * Simulates play from the first click. Step 0 floods the first click. Each
 * later step runs deduce on the visible clues and reveals every cell it
 * proves safe, with flood. Stops when every safe cell is revealed or deduce
 * proves no safe cell.
 *
 * A proven cell gets its deduction's rule. A cell opened by the cascade of
 * another cell's reveal gets 'flood' and that reveal's step; it never
 * inherits the triggering cell's rule.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} mines
 * @param {number} firstClick
 * @param {import('./solver.js').NeighbourTable} [table] neighbourTable(width,
 *   height); built once here if omitted, then shared by every round
 * @returns {Proof}
 */
export function buildProof(width, height, mines, firstClick, table) {
  const n = width * height;
  if (mines.length !== n) throw new RangeError(`mines has length ${mines.length}, expected ${n}`);
  if (!Number.isInteger(firstClick) || firstClick < 0 || firstClick >= n) {
    throw new RangeError(`firstClick out of range: ${firstClick}`);
  }
  if (mines[firstClick]) throw new RangeError(`firstClick ${firstClick} is a mine`);
  if (table !== undefined && table.length !== n) {
    throw new RangeError(`table has length ${table.length}, expected ${n}`);
  }
  const nbrs = table ?? neighbourTable(width, height);

  const counts = computeCounts(width, height, mines);
  const cells = new Uint8Array(n);
  const stepOf = new Int16Array(n).fill(-1);
  /** @type {(ProofRule | null)[]} */
  const ruleOf = new Array(n).fill(null);
  /** @type {(number[] | null)[]} */
  const cluesOf = new Array(n).fill(null);
  const pos = new Int32Array(n);
  let covered = n;
  for (const m of mines) covered -= m;

  /**
   * Floods from `starts` and records each opened cell. Starts take their rule
   * and clues from `label`. Every other opened cell was enqueued by its zero
   * neighbour that was dequeued first, which is the one with the lowest
   * position in `opened`; that is the zero recorded for it.
   * @param {number[]} starts
   * @param {number} step
   * @param {(i: number) => { rule: ProofRule, clues: number[] }} label
   */
  const open = (starts, step, label) => {
    const isStart = new Set(starts);
    const { opened } = flood(width, height, counts, cells, starts);
    pos.fill(-1);
    opened.forEach((i, k) => { pos[i] = k; });
    for (const i of opened) {
      stepOf[i] = step;
      if (isStart.has(i)) {
        const { rule, clues } = label(i);
        ruleOf[i] = rule;
        cluesOf[i] = clues;
        continue;
      }
      let opener = -1;
      for (const z of nbrs[i]) {
        if (counts[z] !== 0 || pos[z] < 0) continue;
        if (opener === -1 || pos[z] < pos[opener]) opener = z;
      }
      ruleOf[i] = 'flood';
      cluesOf[i] = [opener];
    }
    covered -= opened.length;
  };

  open([firstClick], 0, () => ({ rule: 'opening', clues: [] }));
  let step = 0;
  while (covered > 0) {
    const d = deduce(width, height, visibleClues({ cells, counts, detonated: null }), nbrs);
    if (d.safe.length === 0) break;
    step++;
    open(d.safe, step, (i) => {
      const w = /** @type {import('./solver.js').Why} */ (d.why.get(i));
      return { rule: w.rule, clues: w.clues };
    });
  }

  const summary = { steps: step, singleCells: 0, subsetCells: 0, floodCells: 0 };
  for (const r of ruleOf) {
    if (r === 'single') summary.singleCells++;
    else if (r === 'subset') summary.subsetCells++;
    else if (r === 'flood') summary.floodCells++;
  }
  return { solved: covered === 0, stepOf, ruleOf, cluesOf, summary };
}

/**
 * The proof-map band (0..7) for a step, spreading steps 0..maxStep evenly
 * over the eight bands. A proof with no step beyond the opening is band 0.
 * @param {number} step
 * @param {number} maxStep
 */
export function bandOf(step, maxStep) {
  if (maxStep === 0) return 0;
  return Math.round((step * 7) / maxStep);
}

/**
 * Every number behind a decision: the cell's own clues, plus the clues of
 * every cell it relied on, transitively through `deps`. Only explainLoss
 * calls this; buildProof and generate never do, so generation never pays for
 * chains.
 * @param {Map<number, import('./solver.js').Why>} why from one deduce call
 * @param {number} cell a cell decided in that call
 * @returns {number[]} ascending
 */
export function explainChain(why, cell) {
  if (!why.has(cell)) throw new RangeError(`cell ${cell} was not decided`);
  /** @type {Set<number>} */
  const clues = new Set();
  const seen = new Set([cell]);
  const stack = [cell];
  while (stack.length > 0) {
    const w = /** @type {import('./solver.js').Why} */ (why.get(/** @type {number} */ (stack.pop())));
    for (const c of w.clues) clues.add(c);
    for (const d of w.deps) {
      if (!seen.has(d)) {
        seen.add(d);
        stack.push(d);
      }
    }
  }
  return [...clues].sort((a, b) => a - b);
}

/**
 * The part of a lost game explainLoss reads.
 * @typedef {object} LostGame
 * @property {number} width
 * @property {number} height
 * @property {string} status
 * @property {'reveal' | 'chord' | null} lossCause
 * @property {number | null} lossAction
 * @property {number | null} detonated
 * @property {Uint8Array} cells
 * @property {Uint8Array | null} counts
 * @property {Uint8Array | null} mines
 */

/**
 * @typedef {{ kind: 'reveal', provable: 'mine', clues: number[] }
 *   | { kind: 'reveal', provable: 'no', safe: number, clues: number[] }
 *   | { kind: 'reveal', provable: 'none' }
 *   | { kind: 'chord', chorded: number, wrongFlags: number[], detonated: number }} LossExplanation
 */

/**
 * Explains a loss.
 *
 * Reveal loss: runs deduce on the clues from just before the fatal click. A
 * loss changes cells only at the detonated index, and visibleClues reads that
 * index as covered, so the clue view of the lost state is the pre-click view.
 * Reports whether the clicked cell was provably a mine; if not, the provably
 * safe cell nearest it (Chebyshev distance, ties to the lowest index); and
 * 'none' if nothing was provable, which only an ungenerated board allows.
 * In 'mine' and 'no' results, `clues` is the whole chain (explainChain):
 * every number the proof of that cell used, not just the last one.
 *
 * Chord loss: the player trusted a wrong flag. Reports the flagged neighbours
 * of the chorded number that are not mines. Reading mines is allowed here:
 * this is a post-mortem, not a deduction.
 * @param {LostGame} state
 * @returns {LossExplanation}
 */
export function explainLoss(state) {
  const { width, height, cells, mines, lossAction, detonated } = state;
  if (state.status !== 'lost' || lossAction === null || detonated === null || mines === null) {
    throw new RangeError('explainLoss needs a lost game');
  }

  if (state.lossCause === 'chord') {
    const wrongFlags = neighbours(width, height, lossAction)
      .filter((i) => cells[i] === 1 && mines[i] === 0);
    return { kind: 'chord', chorded: lossAction, wrongFlags, detonated };
  }
  if (state.lossCause !== 'reveal') throw new RangeError(`unknown lossCause: ${state.lossCause}`);

  const d = deduce(width, height, visibleClues(state));
  if (d.mines.includes(lossAction)) {
    return { kind: 'reveal', provable: 'mine', clues: explainChain(d.why, lossAction) };
  }
  if (d.safe.length === 0) return { kind: 'reveal', provable: 'none' };

  const at = toXY(width, lossAction);
  let best = -1;
  let bestDist = Infinity;
  for (const s of d.safe) {
    const { x, y } = toXY(width, s);
    const dist = Math.max(Math.abs(x - at.x), Math.abs(y - at.y));
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return { kind: 'reveal', provable: 'no', safe: best, clues: explainChain(d.why, best) };
}
