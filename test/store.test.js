import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, hasProgress } from '../src/store.js';
import { buildProof, explainLoss } from '../src/core/proof.js';

/** @typedef {import('../src/core/rules.js').Game} Game */

/** Storage backed by a Map, logging every call. */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const data = new Map();
  /** @type {string[]} */
  const calls = [];
  return {
    data,
    calls,
    /** @param {string} k */
    getItem(k) { calls.push(`get:${k}`); return data.has(k) ? /** @type {string} */ (data.get(k)) : null; },
    /** @param {string} k @param {string} v */
    setItem(k, v) { calls.push(`set:${k}`); data.set(k, v); },
  };
}

function throwingStorage() {
  return {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
}

/** A clock the test drives, and a seed sequence. */
function env(storage = memoryStorage()) {
  const clock = { t: 1000 };
  let seed = 7;
  const store = createStore({ storage, now: () => clock.t, newSeed: () => seed++ });
  /** @type {{ changed: number[], rebuild: boolean, statusChanged: boolean }[]} */
  const events = [];
  store.subscribe((_s, e) => events.push(e));
  return { store, clock, storage, events };
}

/** @param {ReturnType<typeof createStore>} store */
function game(store) {
  return store.getState().game;
}

/** @param {Game} g */
function mines(g) {
  assert.ok(g.mines, 'board has mines');
  return g.mines;
}

/** @param {Game} g */
function counts(g) {
  assert.ok(g.counts, 'board has counts');
  return g.counts;
}

/**
 * Reveals every safe cell in index order until the game is won.
 * @param {ReturnType<typeof createStore>} store */
function playToWin(store) {
  let g = game(store);
  if (g.status === 'ready') store.dispatch({ type: 'reveal', index: 40 });
  g = game(store);
  const m = mines(g);
  for (let i = 0; i < m.length && game(store).status === 'playing'; i++) {
    if (!m[i] && game(store).cells[i] === 0) store.dispatch({ type: 'reveal', index: i });
  }
}

test('a fresh store with empty storage starts a ready Beginner game', () => {
  const { store } = env();
  const s = store.getState();
  assert.equal(s.settings.difficulty, 'beginner');
  assert.equal(s.game.status, 'ready');
  assert.equal(s.game.width, 9);
  assert.equal(s.flagMode, false);
});

test('a flood reveal emits exactly the flooded set', () => {
  const { store, events } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  const g = game(store);
  assert.equal(g.status, 'playing', 'precondition: the opening did not win the board');
  const revealed = [];
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === 2) revealed.push(i);
  assert.ok(revealed.length > 1);
  assert.deepEqual(events.at(-1)?.changed, revealed);
});

test('a single-cell reveal emits exactly one changed index', () => {
  const { store, events } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  const g = game(store);
  const m = mines(g);
  const c = counts(g);
  const target = [...g.cells.keys()].find((i) => g.cells[i] === 0 && !m[i] && c[i] > 0);
  assert.ok(target !== undefined, 'precondition: a covered numbered safe cell exists');
  store.dispatch({ type: 'reveal', index: target });
  assert.equal(game(store).status, 'playing', 'precondition: this reveal did not win');
  assert.deepEqual(events.at(-1)?.changed, [target]);
});

test('a no-op dispatch emits nothing and keeps the same game object', () => {
  const { store, events } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  const before = game(store);
  const n = events.length;
  store.dispatch({ type: 'reveal', index: 40 });
  store.dispatch({ type: 'flag', index: 40 });
  assert.equal(events.length, n);
  assert.equal(game(store), before);
});

test('flag emits the flagged index and statusChanged false', () => {
  const { store, events } = env();
  store.dispatch({ type: 'flag', index: 3 });
  assert.deepEqual(events.at(-1), { changed: [3], rebuild: false, statusChanged: false });
});

test('the first reveal reports statusChanged from ready to playing', () => {
  const { store, events } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  assert.equal(events.at(-1)?.statusChanged, true);
  assert.equal(events.at(-1)?.rebuild, false);
});

test('newGame and setDifficulty set rebuild', () => {
  const { store, events } = env();
  store.dispatch({ type: 'newGame' });
  assert.deepEqual(events.at(-1), { changed: [], rebuild: true, statusChanged: false });
  store.dispatch({ type: 'setDifficulty', difficulty: 'expert' });
  assert.equal(events.at(-1)?.rebuild, true);
  assert.equal(store.getState().settings.difficulty, 'expert');
  assert.equal(game(store).width, 30);
});

test('setDifficulty to the current difficulty is a no-op', () => {
  const { store, events } = env();
  store.dispatch({ type: 'setDifficulty', difficulty: 'beginner' });
  assert.equal(events.length, 0);
});

test('newGame after a win reports statusChanged back to ready', () => {
  const { store, events } = env();
  playToWin(store);
  store.dispatch({ type: 'newGame' });
  assert.deepEqual(events.at(-1), { changed: [], rebuild: true, statusChanged: true });
  assert.equal(game(store).status, 'ready');
});

test('toggleFlagMode flips flag mode and emits no changed cells', () => {
  const { store, events } = env();
  store.dispatch({ type: 'toggleFlagMode' });
  assert.equal(store.getState().flagMode, true);
  assert.deepEqual(events.at(-1), { changed: [], rebuild: false, statusChanged: false });
  store.dispatch({ type: 'toggleFlagMode' });
  assert.equal(store.getState().flagMode, false);
});

test('chord on a satisfied number opens its covered neighbours', () => {
  const { store, events } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  const g = game(store);
  const m = mines(g);
  const c = counts(g);
  const w = g.width;
  // A revealed number with at least one covered safe neighbour.
  const nb = (/** @type {number} */ i) => {
    const x = i % w; const y = Math.floor(i / w); const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < g.height) out.push((y + dy) * w + x + dx);
    }
    return out;
  };
  const num = [...g.cells.keys()].find((i) => g.cells[i] === 2 && c[i] > 0 && nb(i).some((n) => g.cells[n] === 0 && !m[n]));
  assert.ok(num !== undefined, 'precondition');
  for (const n of nb(num)) if (m[n] && game(store).cells[n] === 0) store.dispatch({ type: 'flag', index: n });
  const covered = nb(num).filter((n) => game(store).cells[n] === 0);
  store.dispatch({ type: 'chord', index: num });
  for (const n of covered) assert.equal(game(store).cells[n], 2);
  const changed = events.at(-1)?.changed ?? [];
  assert.deepEqual(changed, [...changed].sort((a, b) => a - b));
  assert.equal(new Set(changed).size, changed.length);
});

test('getProof is null until a win, then built once and memoised by identity', () => {
  const { store } = env();
  assert.equal(store.getProof(), null);
  playToWin(store);
  const g = game(store);
  assert.equal(g.status, 'won');
  const p = store.getProof();
  assert.ok(p);
  assert.equal(store.getProof(), p);
  store.dispatch({ type: 'reveal', index: 0 });
  store.dispatch({ type: 'pause' });
  assert.equal(store.getProof(), p, 'no-op dispatches after the win keep the same proof object');
  assert.deepEqual(p, buildProof(g.width, g.height, mines(g), /** @type {number} */ (g.firstClick)));
  store.dispatch({ type: 'newGame' });
  assert.equal(store.getProof(), null);
  assert.equal(store.getLossInfo(), null);
});

test('getLossInfo is null until a loss, then built once and memoised by identity', () => {
  const { store } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  assert.equal(store.getLossInfo(), null);
  const m = mines(game(store));
  store.dispatch({ type: 'reveal', index: m.indexOf(1) });
  assert.equal(game(store).status, 'lost');
  const info = store.getLossInfo();
  assert.ok(info);
  assert.equal(store.getLossInfo(), info);
  store.dispatch({ type: 'reveal', index: 0 });
  assert.equal(store.getLossInfo(), info);
  assert.deepEqual(info, explainLoss(game(store)));
  assert.equal(store.getProof(), null);
});

test('pause and resume stop and restart the clock and are no-ops when repeated', () => {
  const { store, clock, events } = env();
  store.dispatch({ type: 'reveal', index: 40 });
  clock.t += 500;
  store.dispatch({ type: 'pause' });
  const n = events.length;
  store.dispatch({ type: 'pause' });
  assert.equal(events.length, n);
  clock.t += 10_000;
  assert.equal(store.elapsed(), 500);
  store.dispatch({ type: 'resume' });
  clock.t += 250;
  assert.equal(store.elapsed(), 750);
});

test('a storage whose getItem and setItem both throw still plays a full game to a win', () => {
  const { store, events } = env(/** @type {any} */ (throwingStorage()));
  store.dispatch({ type: 'flag', index: 0 });
  store.dispatch({ type: 'flag', index: 0 });
  playToWin(store);
  assert.equal(game(store).status, 'won');
  assert.equal(events.filter((e) => e.statusChanged).length, 2);
  assert.ok(store.getProof());
});

test('a storage whose methods throw still allows a full game to a loss and a new game', () => {
  const { store } = env(/** @type {any} */ (throwingStorage()));
  store.dispatch({ type: 'reveal', index: 40 });
  store.dispatch({ type: 'reveal', index: mines(game(store)).indexOf(1) });
  assert.equal(game(store).status, 'lost');
  assert.ok(store.getLossInfo());
  store.dispatch({ type: 'newGame' });
  assert.equal(game(store).status, 'ready');
});

test('hasProgress is false before and right after the first click, true after a later move', () => {
  const { store } = env();
  assert.equal(hasProgress(game(store)), false);
  store.dispatch({ type: 'flag', index: 0 });
  assert.equal(hasProgress(game(store)), false, 'a ready game has no progress even with a flag');
  store.dispatch({ type: 'flag', index: 0 });
  store.dispatch({ type: 'reveal', index: 40 });
  assert.equal(hasProgress(game(store)), false);
  const g = game(store);
  const m = mines(g);
  const covered = [...g.cells.keys()].find((i) => g.cells[i] === 0 && m[i]);
  store.dispatch({ type: 'flag', index: /** @type {number} */ (covered) });
  assert.equal(hasProgress(game(store)), true);
});

test('hasProgress is false once the game is over', () => {
  const { store } = env();
  playToWin(store);
  assert.equal(hasProgress(game(store)), false);
});
