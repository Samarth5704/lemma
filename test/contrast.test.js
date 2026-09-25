import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, hexToOklab, deltaE, checkTokens } from '../scripts/contrast.mjs';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

test('#000000 on #ffffff is 21:1', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
});

test('#777777 on #ffffff is 4.48:1 to two decimals', () => {
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48');
});

test('contrast ratio is the same with the colours swapped', () => {
  for (const [a, b] of [['#777777', '#ffffff'], ['#1a46c0', '#fbf8f0'], ['#123456', '#fedcba']]) {
    assert.equal(contrastRatio(a, b), contrastRatio(b, a));
  }
});

test('white is OKLab L 1.000 with a and b within 1e-3 of zero', () => {
  const { L, a, b } = hexToOklab('#ffffff');
  assert.equal(L.toFixed(3), '1.000');
  assert.ok(Math.abs(a) < 1e-3, `a = ${a}`);
  assert.ok(Math.abs(b) < 1e-3, `b = ${b}`);
});

test('the shipped tokens.css passes every check', () => {
  assert.deepEqual(checkTokens(css).failures, []);
});

test('a token missing from the light block is reported', () => {
  const broken = css.replace(/^\s*--glyph-flag:.*\n/m, '');
  assert.notEqual(broken, css);
  const { failures } = checkTokens(broken);
  assert.ok(failures.some((f) => f === 'light: missing token --glyph-flag'), failures.join('\n'));
});

test('a colour token written as oklch() instead of hex is reported', () => {
  const broken = css.replace(/^(\s*--cell-revealed:\s*)#[0-9a-f]{6};/m, '$1oklch(0.98 0.01 90);');
  assert.notEqual(broken, css);
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: --cell-revealed is not a 6-digit hex: oklch(0.98 0.01 90)'),
    failures.join('\n'),
  );
});

test('a 3-digit hex colour token is reported as non-hex', () => {
  const broken = css.replace(/^(\s*--text:\s*)#[0-9a-f]{6};/m, '$1#fff;');
  const { failures } = checkTokens(broken);
  assert.ok(failures.some((f) => f === 'light: --text is not a 6-digit hex: #fff'), failures.join('\n'));
});

test('dark blocks that differ in one value are reported', () => {
  // Change --bg in the [data-theme="dark"] block only; the media block keeps its value.
  const start = css.indexOf('[data-theme="dark"]');
  assert.ok(start >= 0);
  const head = css.slice(0, start);
  const tail = css.slice(start).replace(/(--bg:\s*)#[0-9a-f]{6};/, '$1#010203;');
  const { failures } = checkTokens(head + tail);
  assert.ok(failures.some((f) => f.startsWith('dark blocks differ: --bg')), failures.join('\n'));
});

test('a token present in only one dark block is reported as a difference', () => {
  const start = css.indexOf('@media');
  assert.ok(start >= 0);
  const head = css.slice(0, start);
  const tail = css.slice(start).replace(/^\s*--clue-outline:.*\n/m, '');
  const { failures } = checkTokens(head + tail);
  assert.ok(failures.some((f) => f.startsWith('dark blocks differ: --clue-outline')), failures.join('\n'));
});

test('a focus halo equal to the ring is reported as ring-vs-halo below 3', () => {
  const ring = /^\s*--focus-ring:\s*(#[0-9a-f]{6});/m.exec(css);
  assert.ok(ring);
  const broken = css.replace(/^(\s*--focus-halo:\s*)#[0-9a-f]{6};/m, `$1${ring[1]};`);
  assert.notEqual(broken, css);
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: focus: --focus-ring vs --focus-halo is 1.00, needs 3'),
    failures.join('\n'),
  );
});

test('a surface where neither focus tone reaches 3 is reported', () => {
  // Ring and halo both set to the revealed paper: 1:1 on --cell-revealed.
  const paper = /^\s*--cell-revealed:\s*(#[0-9a-f]{6});/m.exec(css);
  assert.ok(paper);
  const broken = css
    .replace(/^(\s*--focus-ring:\s*)#[0-9a-f]{6};/m, `$1${paper[1]};`)
    .replace(/^(\s*--focus-halo:\s*)#[0-9a-f]{6};/m, `$1${paper[1]};`);
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: focus: neither tone reaches 3 on --cell-revealed (ring 1.00, halo 1.00)'),
    failures.join('\n'),
  );
});

test('adjacent bands with ΔE 0.021 fail the 0.03 floor', () => {
  // The phase 3a light ramp: monotonic, every pair between 0.02 and 0.03.
  const old = ['#f9f4ed', '#f5ede2', '#f1e6d7', '#eddfcb', '#e9d8c0', '#e6d1b4', '#e2caa8', '#dec39d'];
  const dE = deltaE(old[0], old[1]);
  assert.ok(dE >= 0.02 && dE < 0.03, `precondition: ΔE ${dE}`);
  let broken = css;
  old.forEach((hex, k) => {
    broken = broken.replace(new RegExp(String.raw`^(\s*--proof-${k}:\s*)#[0-9a-f]{6};`, 'm'), `$1${hex};`);
  });
  assert.ok(old.every((hex, k) => broken.includes(`--proof-${k}: ${hex};`)), 'all eight bands replaced');
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: ΔE --proof-0 to --proof-1 is 0.021, needs 0.03'),
    failures.join('\n'),
  );
});

test('a covered edge equal to --proof-7 is reported against that band', () => {
  const p7 = /^\s*--proof-7:\s*(#[0-9a-f]{6});/m.exec(css);
  assert.ok(p7);
  const broken = css.replace(/^(\s*--cell-covered-edge:\s*)#[0-9a-f]{6};/m, `$1${p7[1]};`);
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: covered edge: --cell-covered-edge on --proof-7 is 1.00, needs 3'),
    failures.join('\n'),
  );
});

test('two number colours with OKLab ΔE 0.05 fail the 0.08 separation floor', () => {
  const a = '#8a0705';
  const b = '#8a2e05';
  assert.equal(deltaE(a, b).toFixed(2), '0.05', 'precondition');
  const broken = css
    .replace(/^(\s*--num-3:\s*)#[0-9a-f]{6};/m, `$1${a};`)
    .replace(/^(\s*--num-5:\s*)#[0-9a-f]{6};/m, `$1${b};`);
  assert.ok(broken.includes(`--num-3: ${a};`) && broken.includes(`--num-5: ${b};`));
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: numbers --num-3 and --num-5 differ by ΔE 0.050, needs 0.08'),
    failures.join('\n'),
  );
});

test('a number that passes 4.5 on revealed but fails on --proof-7 passes the checker', () => {
  // Numbers only appear on bands on a won board, where they render in --num-proof.
  const grey = '#6a6a6a';
  const revealed = /^\s*--cell-revealed:\s*(#[0-9a-f]{6});/m.exec(css);
  const p7 = /^\s*--proof-7:\s*(#[0-9a-f]{6});/m.exec(css);
  assert.ok(revealed && p7);
  assert.ok(contrastRatio(grey, revealed[1]) >= 4.5, 'precondition: passes on revealed');
  assert.ok(contrastRatio(grey, p7[1]) < 4.5, 'precondition: fails on proof-7');
  const broken = css.replace(/^(\s*--num-8:\s*)#[0-9a-f]{6};/m, `$1${grey};`);
  assert.ok(broken.includes(`--num-8: ${grey};`));
  assert.deepEqual(checkTokens(broken).failures, []);
});

test('--num-proof failing on --proof-7 fails the checker', () => {
  const p7 = /^\s*--proof-7:\s*(#[0-9a-f]{6});/m.exec(css);
  assert.ok(p7);
  const broken = css.replace(/^(\s*--num-proof:\s*)#[0-9a-f]{6};/m, `$1${p7[1]};`);
  assert.ok(broken.includes(`--num-proof: ${p7[1]};`), 'light --num-proof replaced');
  const { failures } = checkTokens(broken);
  assert.ok(
    failures.some((f) => f === 'light: num-proof: --num-proof on --proof-7 is 1.00, needs 4.5'),
    failures.join('\n'),
  );
});
