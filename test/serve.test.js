import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { resolveRequest, mimeType } from '../scripts/serve.mjs';

const ROOT = resolve(import.meta.dirname, '..');

test('serve maps / to index.html and a plain path to the file under the root', () => {
  assert.equal(resolveRequest(ROOT, '/'), join(ROOT, 'index.html'));
  assert.equal(resolveRequest(ROOT, '/src/main.js?x=1#y'), join(ROOT, 'src', 'main.js'));
  assert.equal(resolveRequest(ROOT, '/styles/'), join(ROOT, 'styles', 'index.html'));
});

test('serve refuses .. segments, raw and percent-encoded', () => {
  assert.equal(resolveRequest(ROOT, '/../package.json'), null);
  assert.equal(resolveRequest(ROOT, '/src/../../x'), null);
  assert.equal(resolveRequest(ROOT, '/%2e%2e/x'), null);
  assert.equal(resolveRequest(ROOT, '/src/%2E%2E/%2e%2e/x'), null);
});

test('serve refuses backslashes, null bytes, bad encodings and non-rooted paths', () => {
  assert.equal(resolveRequest(ROOT, '/..\\x'), null);
  assert.equal(resolveRequest(ROOT, '/src%5c..%5c..%5cx'), null);
  assert.equal(resolveRequest(ROOT, '/index.html%00.js'), null);
  assert.equal(resolveRequest(ROOT, '/%E0%A4%A'), null);
  assert.equal(resolveRequest(ROOT, 'index.html'), null);
  assert.equal(resolveRequest(ROOT, '//etc/passwd'), null);
  assert.equal(resolveRequest(ROOT, '/C:/Windows/win.ini'), null);
});

test('serve refuses dotfiles and dot-directories such as .git', () => {
  assert.equal(resolveRequest(ROOT, '/.git/config'), null);
  assert.equal(resolveRequest(ROOT, '/.gitignore'), null);
  assert.equal(resolveRequest(ROOT, '/src/.hidden.js'), null);
});

test('serve gives correct MIME types for html, css, js, mjs and svg', () => {
  assert.equal(mimeType('a.html'), 'text/html; charset=utf-8');
  assert.equal(mimeType('a.css'), 'text/css; charset=utf-8');
  assert.equal(mimeType('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(mimeType('a.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(mimeType('a.svg'), 'image/svg+xml');
  assert.equal(mimeType('A.JS'), 'text/javascript; charset=utf-8');
  assert.equal(mimeType('a.bin'), 'application/octet-stream');
});
