import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, reveal } from '../src/core/rules.js';
import { GENERATOR_VERSION } from '../src/core/generate.js';

/**
 * A saved game stores only (config, seed, firstClick); load regenerates the
 * mines through the same path as the first reveal. If that path's output
 * changes, every save made before the change would load a different board.
 * These hashes were recorded from the generator at GENERATOR_VERSION 1.
 */
const RECORDED_VERSION = 1;
const GOLDEN = [
  { config: { width: 9, height: 9, mines: 10 }, seed: 1, firstClick: 40, hash: '61201e38' },
  { config: { width: 9, height: 9, mines: 10 }, seed: 2, firstClick: 0, hash: 'cfa0dad5' },
  { config: { width: 9, height: 9, mines: 10 }, seed: 3, firstClick: 4, hash: '3a59590c' },
  { config: { width: 16, height: 16, mines: 40 }, seed: 11, firstClick: 136, hash: '14070f82' },
  { config: { width: 16, height: 16, mines: 40 }, seed: 12, firstClick: 0, hash: '2dea3135' },
  { config: { width: 16, height: 16, mines: 40 }, seed: 13, firstClick: 7, hash: 'd9418728' },
  { config: { width: 30, height: 16, mines: 99 }, seed: 21, firstClick: 239, hash: '15aa3334' },
  { config: { width: 30, height: 16, mines: 99 }, seed: 22, firstClick: 0, hash: 'ccb58de7' },
  { config: { width: 30, height: 16, mines: 99 }, seed: 23, firstClick: 14, hash: 'a9c6e6e4' },
];

const BUMP = 'bump GENERATOR_VERSION in src/core/generate.js, then re-record the hashes and RECORDED_VERSION in test/golden.test.js';

/**
 * FNV-1a (32-bit) over the comma-joined mine indices.
 * @param {number[]} ids
 */
function fnv1a(ids) {
  let h = 0x811c9dc5;
  for (const ch of ids.join(',')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

test('generator output is unchanged; bump GENERATOR_VERSION if this fails', () => {
  assert.equal(GENERATOR_VERSION, RECORDED_VERSION,
    `GENERATOR_VERSION is ${GENERATOR_VERSION} but the hashes were recorded at ${RECORDED_VERSION}: re-record the hashes and RECORDED_VERSION`);
  for (const { config, seed, firstClick, hash } of GOLDEN) {
    const { mines } = reveal(newGame(config, seed), firstClick, 0).state;
    assert.ok(mines);
    /** @type {number[]} */
    const ids = [];
    mines.forEach((m, i) => { if (m) ids.push(i); });
    assert.equal(fnv1a(ids), hash,
      `${config.width}x${config.height} seed ${seed} firstClick ${firstClick}: mine layout changed; ${BUMP}`);
  }
});
