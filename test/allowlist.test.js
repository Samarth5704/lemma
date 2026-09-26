import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkShape,
  checkClassification,
  localReferences,
  checkReferences,
  checkRootAbsolute,
  stage,
} from '../scripts/allowlist.mjs';

const has = (/** @type {string[]} */ paths) => (/** @type {string} */ p) => paths.includes(p);

test('allowlist fails on a tracked file listed under neither publish nor exclude', () => {
  const errors = checkClassification(
    ['index.html', 'src/main.js', 'notes.txt'],
    { publish: ['index.html', 'src/main.js'], exclude: [] },
    () => true,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unclassified.*notes\.txt/);
});

test('allowlist fails on a listed file that does not exist, in either list', () => {
  const errors = checkClassification(
    ['index.html'],
    { publish: ['index.html', 'src/gone.js'], exclude: ['old.md'] },
    has(['index.html']),
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0], /does not exist.*src\/gone\.js/);
  assert.match(errors[1], /does not exist.*old\.md/);
});

test('allowlist fails on a file listed under both publish and exclude', () => {
  const errors = checkClassification(
    ['index.html', 'README.md'],
    { publish: ['index.html', 'README.md'], exclude: ['README.md'] },
    () => true,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /both publish and exclude.*README\.md/);
});

test('allowlist passes when every tracked file is classified once and exists', () => {
  const errors = checkClassification(
    ['index.html', 'README.md'],
    { publish: ['index.html'], exclude: ['README.md'] },
    () => true,
  );
  assert.deepEqual(errors, []);
});

test('allowlist rejects globs, a missing list and non-relative paths in the JSON', () => {
  assert.deepEqual(checkShape({ publish: ['index.html'], exclude: ['README.md'] }), []);
  assert.match(checkShape({ publish: ['index.html'] }).join('\n'), /"exclude" must be an array/);
  assert.match(checkShape({ publish: ['src/*.js'], exclude: [] }).join('\n'), /exact path.*src\/\*\.js/);
  assert.match(checkShape({ publish: ['src/**'], exclude: [] }).join('\n'), /exact path/);
  assert.match(checkShape({ publish: ['/index.html'], exclude: [] }).join('\n'), /exact path/);
  assert.match(checkShape({ publish: ['./index.html'], exclude: [] }).join('\n'), /exact path/);
  assert.match(checkShape({ publish: ['src\\main.js'], exclude: [] }).join('\n'), /exact path/);
  assert.match(checkShape({ publish: [], exclude: [], extra: [] }).join('\n'), /unknown key "extra"/);
});

test('allowlist finds relative specifiers in static, re-export, bare and dynamic imports', () => {
  const src = [
    "import { a } from './a.js';",
    "import * as b from '../core/b.js';",
    "export { c } from \"./c.js\";",
    "import './side.js';",
    "const d = await import('./d.js');",
    "/** @typedef {import('./types.js').T} T */",
    "import { readFileSync } from 'node:fs';",
    "import x from 'pkg';",
  ].join('\n');
  assert.deepEqual(
    localReferences('src/view/grid.js', src).map((r) => r.path),
    ['src/view/a.js', 'src/core/b.js', 'src/view/c.js', 'src/view/side.js', 'src/view/d.js', 'src/view/types.js'],
  );
});

test('allowlist fails on a published JS file importing a file outside the publish set', () => {
  const files = new Map([
    ['src/main.js', "import { s } from './store.js';\nimport { t } from './tools/debug.js';"],
    ['src/store.js', 'export const s = 1;'],
  ]);
  const errors = checkReferences(files, new Set(['src/main.js', 'src/store.js']));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /src\/main\.js.*'\.\/tools\/debug\.js'.*src\/tools\/debug\.js.*not in the publish set/);
});

test('allowlist fails on an index.html href or src that points outside the publish set', () => {
  const html = [
    '<link rel="stylesheet" href="styles/tokens.css">',
    "<link rel='stylesheet' href='styles/extra.css'>",
    '<script type="module" src="src/main.js?v=2"></script>',
    '<img src=docs/shot.png>',
    '<a href="#board">skip</a>',
    '<a href="https://example.com/x">x</a>',
    '<link rel="icon" href="data:,">',
    '<svg><use href="#g-flag"/></svg>',
  ].join('\n');
  const files = new Map([['index.html', html]]);
  const publish = new Set(['index.html', 'styles/tokens.css', 'src/main.js']);
  assert.deepEqual(
    localReferences('index.html', html).map((r) => r.path),
    ['styles/tokens.css', 'styles/extra.css', 'src/main.js', 'docs/shot.png'],
  );
  const errors = checkReferences(files, publish);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /index\.html.*styles\/extra\.css/);
  assert.match(errors[1], /index\.html.*docs\/shot\.png/);
});

test('allowlist fails on a reference that climbs out of the repository', () => {
  const files = new Map([['src/main.js', "import x from '../../secret.js';"]]);
  const errors = checkReferences(files, new Set(['src/main.js']));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /outside the repository/);
});

test('allowlist fails on root-absolute URLs in published HTML, JS and CSS', () => {
  const files = new Map([
    ['index.html', '<script type="module" src="/src/main.js"></script>\n<a href="//cdn.example.com/x">ok</a>'],
    ['src/main.js', "import { s } from '/src/store.js';\nfetch('/data.json');\nconst parts = path.split('/');"],
    ['styles/app.css', '.a { background: url(/img/a.png); }\n.b { background: url("img/b.png"); }'],
    ['src/ok.js', "const re = /^\\/x/;\n// see /docs/spec.md"],
  ]);
  const errors = checkRootAbsolute(files);
  assert.equal(errors.length, 4, errors.join('\n'));
  assert.match(errors[0], /index\.html.*"\/src\/main\.js"/);
  assert.match(errors[1], /src\/main\.js.*"\/src\/store\.js"/);
  assert.match(errors[2], /src\/main\.js.*"\/data\.json"/);
  assert.match(errors[3], /styles\/app\.css.*"\/img\/a\.png"/);
});

test('root-absolute references are reported by the root-absolute check, not as missing files', () => {
  const files = new Map([['index.html', '<script type="module" src="/src/main.js"></script>']]);
  assert.deepEqual(checkReferences(files, new Set(['index.html'])), []);
});

test('staging refuses a non-empty directory and copies nothing into it', () => {
  const root = mkdtempSync(join(tmpdir(), 'lemma-root-'));
  const out = mkdtempSync(join(tmpdir(), 'lemma-stage-'));
  try {
    writeFileSync(join(root, 'index.html'), '<p>hi</p>');
    writeFileSync(join(out, 'stale.txt'), 'old');
    assert.throws(() => stage(root, ['index.html'], out), /not empty/);
    assert.equal(existsSync(join(out, 'index.html')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('staging into a missing or empty directory copies the publish set with its paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'lemma-root-'));
  const parent = mkdtempSync(join(tmpdir(), 'lemma-stage-'));
  try {
    mkdirSync(join(root, 'src', 'core'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<p>hi</p>');
    writeFileSync(join(root, 'src', 'core', 'rng.js'), 'export {};');
    writeFileSync(join(root, 'README.md'), 'not published');
    const out = join(parent, '_site');
    assert.deepEqual(stage(root, ['index.html', 'src/core/rng.js'], out), ['index.html', 'src/core/rng.js']);
    assert.equal(readFileSync(join(out, 'src', 'core', 'rng.js'), 'utf8'), 'export {};');
    assert.equal(existsSync(join(out, 'README.md')), false);
    const empty = join(parent, 'empty');
    mkdirSync(empty);
    assert.deepEqual(stage(root, ['index.html'], empty), ['index.html']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});
