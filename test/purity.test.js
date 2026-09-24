import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = join(import.meta.dirname, '..', 'src', 'core');
const FORBIDDEN = /\b(Math\.random|Date|performance|crypto|localStorage|document|window)\b/g;

/**
 * Removes // and block comments. String and template literals are copied
 * through untouched, so a "//" inside a string is not taken as a comment.
 * @param {string} src
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** @param {string} src */
function forbiddenIn(src) {
  return [...stripComments(src).matchAll(FORBIDDEN)].map((m) => m[0]);
}

test('the forbidden-identifier check flags code and ignores comments', () => {
  assert.deepEqual(forbiddenIn('const t = Date.now();'), ['Date']);
  assert.deepEqual(forbiddenIn('const r = Math.random();'), ['Math.random']);
  assert.deepEqual(forbiddenIn('// Date and window\n/* document */ const x = 1;'), []);
  assert.deepEqual(forbiddenIn('const u = "http://x"; window.foo = 1;'), ['window']);
  assert.deepEqual(forbiddenIn('const updated = 1; const windowed = 2;'), []);
});

test('no src/core file uses Math.random, Date, performance, crypto, localStorage, document or window outside comments', () => {
  const files = readdirSync(CORE).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 4, `expected at least 4 core files, found ${files.length}`);
  for (const f of files) {
    const hits = forbiddenIn(readFileSync(join(CORE, f), 'utf8'));
    assert.deepEqual(hits, [], `${f} uses ${hits.join(', ')}`);
  }
});
