import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { KEY, VERSION, migrate, load, serialize } from '../src/persist.js';
import { buildProof } from '../src/core/proof.js';
import { elapsed } from '../src/core/rules.js';
import { GENERATOR_VERSION } from '../src/core/generate.js';

/** @typedef {import('../src/core/rules.js').Game} Game */

function memoryStorage(initial = /** @type {string | null} */ (null)) {
  /** @type {Map<string, string>} */
  const data = new Map();
  if (initial !== null) data.set(KEY, initial);
  let sets = 0;
  return {
    data,
    get sets() { return sets; },
    /** @param {string} k */
    getItem(k) { return data.has(k) ? /** @type {string} */ (data.get(k)) : null; },
    /** @param {string} k @param {string} v */
    setItem(k, v) { sets++; data.set(k, v); },
  };
}

/** @param {ReturnType<typeof memoryStorage>} storage */
function stored(storage) {
  const raw = storage.data.get(KEY);
  assert.ok(raw, 'something was saved');
  return JSON.parse(raw);
}

/**
 * @param {ReturnType<typeof memoryStorage>} storage
 * @param {{ t: number }} clock
 */
function open(storage, clock) {
  let seed = 100;
  return createStore({ storage, now: () => clock.t, newSeed: () => seed++ });
}

/** @param {Game} g */
function mines(g) {
  assert.ok(g.mines);
  return g.mines;
}

/**
 * A Beginner game in progress: opening, one flag on a mine, and one more
 * safe reveal, with time passing between moves.
 */
function inProgress() {
  const storage = memoryStorage();
  const clock = { t: 5000 };
  const store = open(storage, clock);
  store.dispatch({ type: 'reveal', index: 40 });
  clock.t += 1200;
  const g = store.getState().game;
  const m = mines(g);
  const mine = [...g.cells.keys()].find((i) => g.cells[i] === 0 && m[i]);
  store.dispatch({ type: 'flag', index: /** @type {number} */ (mine) });
  clock.t += 800;
  const safe = [...g.cells.keys()].find((i) => store.getState().game.cells[i] === 0 && !m[i]);
  store.dispatch({ type: 'reveal', index: /** @type {number} */ (safe) });
  clock.t += 300;
  assert.equal(store.getState().game.status, 'playing', 'precondition: still playing');
  return { storage, clock, store };
}

// ---- migrate ----

test('migrate passes a version 1 payload through', () => {
  const p = { version: 1, settings: { difficulty: 'expert' } };
  assert.deepEqual(migrate(p), { ok: true, payload: p });
});

test('migrate reports a higher version as an unknown future version', () => {
  assert.deepEqual(migrate({ version: 99, settings: {} }), { ok: false, future: true });
  assert.deepEqual(migrate({ version: VERSION + 1 }), { ok: false, future: true });
});

test('migrate rejects a missing, zero, fractional or non-numeric version as invalid, not future', () => {
  for (const raw of [null, 3, 'x', [], {}, { version: 0 }, { version: 1.5 }, { version: '1' }]) {
    assert.deepEqual(migrate(raw), { ok: false, future: false }, JSON.stringify(raw));
  }
});

// ---- round trip ----

test('an in-progress game saved and loaded round-trips cells, status, elapsed time and proof', () => {
  const { storage, clock, store } = inProgress();
  store.dispatch({ type: 'pause' });
  const before = store.getState().game;
  const savedElapsed = elapsed(before, clock.t);
  clock.t = 42; // a new page: performance.now restarts
  const again = open(storage, clock);
  const after = again.getState().game;
  assert.deepEqual(after.cells, before.cells);
  assert.equal(after.status, before.status);
  assert.equal(after.seed, before.seed);
  assert.equal(after.firstClick, before.firstClick);
  assert.equal(elapsed(after, clock.t), savedElapsed);
  const f = /** @type {number} */ (before.firstClick);
  assert.deepEqual(buildProof(9, 9, mines(after), f), buildProof(9, 9, mines(before), f));
});

test('load regenerates mines identical to the pre-save game', () => {
  const { storage, clock, store } = inProgress();
  const before = store.getState().game;
  const after = open(storage, clock).getState().game;
  assert.deepEqual(after.mines, before.mines);
  assert.deepEqual(after.counts, before.counts);
});

test('the persisted JSON contains no mines, counts, stepOf, proof or resumedAt keys', () => {
  const { storage } = inProgress();
  /** @type {string[]} */
  const keys = [];
  /** @param {unknown} v */
  const walk = (v) => {
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
    }
  };
  const payload = stored(storage);
  walk(payload);
  for (const bad of ['mines', 'counts', 'stepOf', 'proof', 'resumedAt']) {
    assert.ok(!keys.includes(bad), `found ${bad}`);
  }
  assert.equal(payload.version, 1);
  assert.equal(payload.game.gen, GENERATOR_VERSION);
  assert.match(payload.game.cells, /^[012]{81}$/);
  assert.deepEqual(Object.keys(payload.game).sort(), [
    'accumulatedMs', 'cells', 'detonated', 'firstClick', 'gen', 'height', 'lossAction',
    'lossCause', 'mineCount', 'seed', 'status', 'width',
  ]);
});

test('accumulatedMs is saved as elapsed at save time, including the running segment', () => {
  const { store, clock } = inProgress();
  const g = store.getState().game;
  const p = serialize(store.getState().settings, g, clock.t);
  assert.equal(p.game?.accumulatedMs, elapsed(g, clock.t));
  assert.ok((p.game?.accumulatedMs ?? 0) >= 2000);
});

test('a loaded playing game reports the saved elapsed time at load and keeps accumulating', () => {
  const { storage, clock, store } = inProgress();
  const savedAt = clock.t;
  const covered = [...store.getState().game.cells.keys()].find((i) => store.getState().game.cells[i] === 0);
  assert.ok(covered !== undefined, 'precondition: a covered cell to flag');
  store.dispatch({ type: 'flag', index: covered }); // a state-changing dispatch saves
  const saved = stored(storage).game.accumulatedMs;
  assert.equal(saved, elapsed(store.getState().game, savedAt));
  clock.t = 10; // new page
  const again = open(storage, clock);
  assert.equal(again.elapsed(), saved);
  clock.t += 1500;
  assert.equal(again.elapsed(), saved + 1500);
});

test('a won game and a lost game round-trip', () => {
  for (const outcome of ['won', 'lost']) {
    const storage = memoryStorage();
    const clock = { t: 0 };
    const store = open(storage, clock);
    store.dispatch({ type: 'reveal', index: 40 });
    const m = mines(store.getState().game);
    if (outcome === 'lost') {
      store.dispatch({ type: 'reveal', index: m.indexOf(1) });
    } else {
      for (let i = 0; i < m.length && store.getState().game.status === 'playing'; i++) {
        if (!m[i] && store.getState().game.cells[i] === 0) store.dispatch({ type: 'reveal', index: i });
      }
    }
    const before = store.getState().game;
    assert.equal(before.status, outcome);
    const after = open(storage, clock).getState().game;
    assert.equal(after.status, outcome);
    assert.deepEqual(after.cells, before.cells);
    assert.equal(after.detonated, before.detonated);
    assert.equal(after.lossCause, before.lossCause);
    assert.equal(after.lossAction, before.lossAction);
  }
});

// ---- fallbacks ----

test('corrupted JSON loads defaults, and later saves are allowed', () => {
  const storage = memoryStorage('{"version":1,"settings":');
  const store = open(storage, { t: 0 });
  assert.equal(store.getState().settings.difficulty, 'beginner');
  assert.equal(store.getState().game.status, 'ready');
  store.dispatch({ type: 'flag', index: 0 });
  assert.equal(storage.sets, 1);
});

test('a version 99 payload loads defaults and setItem is never called, even after ten dispatches', () => {
  const raw = JSON.stringify({ version: 99, settings: { difficulty: 'expert' }, future: true });
  const storage = memoryStorage(raw);
  const clock = { t: 0 };
  const store = open(storage, clock);
  assert.equal(store.getState().settings.difficulty, 'beginner');
  const actions = [
    { type: 'reveal', index: 40 }, { type: 'flag', index: 0 }, { type: 'flag', index: 0 },
    { type: 'toggleFlagMode' }, { type: 'pause' }, { type: 'resume' },
    { type: 'setDifficulty', difficulty: 'intermediate' }, { type: 'reveal', index: 100 },
    { type: 'newGame' }, { type: 'setDifficulty', difficulty: 'beginner' },
  ];
  for (const a of actions) {
    clock.t += 100;
    store.dispatch(/** @type {any} */ (a));
  }
  assert.equal(storage.sets, 0);
  assert.equal(storage.data.get(KEY), raw);
});

test('a saved payload containing no game loads settings only', () => {
  const storage = memoryStorage(JSON.stringify({ version: 1, settings: { difficulty: 'expert' } }));
  const store = open(storage, { t: 0 });
  assert.equal(store.getState().settings.difficulty, 'expert');
  assert.equal(store.getState().game.status, 'ready');
  assert.equal(store.getState().game.width, 30);
});

test('an unknown difficulty in settings falls back to beginner', () => {
  const storage = memoryStorage(JSON.stringify({ version: 1, settings: { difficulty: 'custom' } }));
  assert.equal(open(storage, { t: 0 }).getState().settings.difficulty, 'beginner');
});

/**
 * Saves an in-progress Intermediate game, lets `edit` change the payload, and
 * loads it.
 * @param {(game: any) => void} edit
 */
function tampered(edit) {
  const storage = memoryStorage();
  const clock = { t: 0 };
  const store = open(storage, clock);
  store.dispatch({ type: 'setDifficulty', difficulty: 'intermediate' });
  store.dispatch({ type: 'reveal', index: 136 });
  const before = store.getState().game;
  const payload = stored(storage);
  edit(payload.game);
  storage.data.set(KEY, JSON.stringify(payload));
  return { before, loaded: open(storage, clock).getState() };
}

test('a gen mismatch drops the game and keeps the settings', () => {
  const { loaded } = tampered((g) => { g.gen = GENERATOR_VERSION + 1; });
  assert.equal(loaded.settings.difficulty, 'intermediate');
  assert.equal(loaded.game.status, 'ready');
  assert.equal(loaded.game.width, 16);
});

test('a save whose cells show a revealed mine that is not the detonated cell drops the game', () => {
  // tampered() is deterministic (same seeds), so the control run tells us
  // where a mine is on the board the second run saves.
  const control = tampered(() => {});
  assert.equal(control.loaded.game.status, 'playing', 'control: the untampered save loads');
  const mine = mines(control.before).indexOf(1);
  const { before, loaded } = tampered((g) => {
    g.cells = g.cells.slice(0, mine) + '2' + g.cells.slice(mine + 1);
  });
  assert.deepEqual(before.mines, control.before.mines);
  assert.equal(loaded.settings.difficulty, 'intermediate');
  assert.equal(loaded.game.status, 'ready');
});

test('a lost save whose detonated cell is not a mine drops the game', () => {
  const { loaded } = tampered((g) => {
    g.status = 'lost';
    g.detonated = 136;
    g.lossCause = 'reveal';
    g.lossAction = 136;
  });
  assert.equal(loaded.game.status, 'ready');
});

test('a cells string of the wrong length or with a bad character drops the game', () => {
  assert.equal(tampered((g) => { g.cells = g.cells.slice(1); }).loaded.game.status, 'ready');
  assert.equal(tampered((g) => { g.cells = '3' + g.cells.slice(1); }).loaded.game.status, 'ready');
});

test('a game whose size does not match the saved difficulty drops the game', () => {
  const { loaded } = tampered((g) => { g.width = 30; g.cells = g.cells + '0'.repeat(14 * 16); });
  assert.equal(loaded.settings.difficulty, 'intermediate');
  assert.equal(loaded.game.status, 'ready');
  assert.equal(loaded.game.width, 16);
});

test('load reads settings and game from a storage whose getItem throws as defaults', () => {
  const r = load({ getItem() { throw new Error('x'); } }, 0);
  assert.equal(r.settings.difficulty, 'beginner');
  assert.equal(r.game, null);
  assert.equal(r.writable, true);
});
