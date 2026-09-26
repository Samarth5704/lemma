// Publish allowlist check. Every tracked file (git ls-files) must be listed in
// publish-allowlist.json under exactly one of "publish" or "exclude", by exact
// path. Published files may only reference other published files, and never a
// root-absolute URL, because GitHub Pages serves the site under /lemma/.
// Usage: npm run allowlist
//        node scripts/allowlist.mjs --stage <dir>   (copies the publish set)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {{ publish: string[], exclude: string[] }} Allowlist */
/** @typedef {{ spec: string, path: string }} Reference */

const KEYS = ['publish', 'exclude'];
// Globs, a leading / or ./, backslashes, empty, . or .. segments, trailing /.
const NOT_EXACT = /[*?[\]{}!\\]|^\/|^\.\/|\/\/|(^|\/)\.\.?(\/|$)|\/$|^$/;

/**
 * Validates the parsed JSON: exactly the keys "publish" and "exclude", each an
 * array of exact relative paths with no duplicates.
 * @param {unknown} json
 * @returns {string[]} errors
 */
export function checkShape(json) {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return ['publish-allowlist.json must be an object with "publish" and "exclude" arrays'];
  }
  const errors = [];
  for (const key of Object.keys(json)) {
    if (!KEYS.includes(key)) errors.push(`unknown key "${key}" in publish-allowlist.json`);
  }
  for (const key of KEYS) {
    const list = /** @type {Record<string, unknown>} */ (json)[key];
    if (!Array.isArray(list)) {
      errors.push(`"${key}" must be an array of paths`);
      continue;
    }
    const seen = new Set();
    for (const p of list) {
      if (typeof p !== 'string' || NOT_EXACT.test(p)) {
        errors.push(`${key} entry is not an exact path: ${String(p)} (no globs, no leading / or ./, forward slashes only)`);
      } else if (seen.has(p)) {
        errors.push(`listed twice in ${key}: ${p}`);
      }
      seen.add(p);
    }
  }
  return errors;
}

/**
 * (a) tracked but unclassified, (b) listed but missing, (c) listed twice.
 * @param {string[]} tracked paths from git ls-files
 * @param {Allowlist} list
 * @param {(path: string) => boolean} exists true for a regular file on disk
 * @returns {string[]} errors
 */
export function checkClassification(tracked, list, exists) {
  const publish = new Set(list.publish);
  const exclude = new Set(list.exclude);
  const errors = [];
  for (const p of list.publish) {
    if (exclude.has(p)) errors.push(`listed under both publish and exclude: ${p}`);
  }
  for (const p of tracked) {
    if (!publish.has(p) && !exclude.has(p)) {
      errors.push(`unclassified tracked file: ${p} (add it to "publish" or "exclude")`);
    }
  }
  for (const p of [...list.publish, ...list.exclude]) {
    if (!exists(p)) errors.push(`listed file does not exist: ${p}`);
  }
  return errors;
}

const JS_SPECIFIER =
  /\b(?:(?:import|export)\s[^'"`;]*?\bfrom\s*|import\s*\(\s*|import\s*)(['"])([^'"\n]+)\1/g;
const HTML_URL = /\s(?:href|src|action|formaction|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every URL-bearing string in a published file, in source order: import
 * specifiers for JS, href/src (and similar) attributes for HTML, url() and
 * @import for CSS.
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function urlsIn(file, text) {
  const re = file.endsWith('.html') ? HTML_URL : file.endsWith('.css') ? CSS_URL : JS_SPECIFIER;
  const out = [];
  for (const m of text.matchAll(re)) {
    const groups = re === JS_SPECIFIER ? [m[2]] : m.slice(1);
    const value = groups.find((g) => g !== undefined);
    if (value !== undefined) out.push(value.trim());
  }
  return out;
}

/**
 * The local files a published file refers to, resolved against its directory
 * to repo-relative posix paths. JS counts only ./ and ../ specifiers (bare
 * and node: specifiers are not files). HTML and CSS skip fragments, schemes,
 * protocol-relative and root-absolute URLs; checkRootAbsolute reports the
 * last kind. A path that starts with ".." climbs out of the repository.
 * @param {string} file repo-relative posix path
 * @param {string} text
 * @returns {Reference[]}
 */
export function localReferences(file, text) {
  const isJs = !file.endsWith('.html') && !file.endsWith('.css');
  const refs = [];
  for (const spec of urlsIn(file, text)) {
    if (isJs ? !/^\.\.?\//.test(spec) : spec === '' || /^[#/]/.test(spec) || SCHEME.test(spec)) continue;
    const bare = spec.split(/[?#]/, 1)[0];
    refs.push({ spec, path: posix.normalize(posix.join(posix.dirname(file), bare)) });
  }
  return refs;
}

/**
 * (d) every local reference in a published file must be published too.
 * @param {Map<string, string>} files published path -> contents
 * @param {Set<string>} publish
 * @returns {string[]} errors
 */
export function checkReferences(files, publish) {
  const errors = [];
  for (const [file, text] of files) {
    for (const { spec, path } of localReferences(file, text)) {
      if (path === '..' || path.startsWith('../')) {
        errors.push(`${file}: '${spec}' resolves outside the repository`);
      } else if (!publish.has(path)) {
        errors.push(`${file}: '${spec}' resolves to ${path}, which is not in the publish set`);
      }
    }
  }
  return errors;
}

// A quoted JS string that starts with a single / and a path character.
const JS_ROOT_STRING = /(['"`])(\/[A-Za-z0-9_.~%-][^'"`\s]*)\1/g;

/**
 * (e) no root-absolute URL ("/x", not "//host") in any published file. The
 * site is served under /lemma/, so "/src/main.js" would miss it. JS is
 * checked for any quoted string of that form, which covers import
 * specifiers, fetch() and new URL().
 * @param {Map<string, string>} files published path -> contents
 * @returns {string[]} errors
 */
export function checkRootAbsolute(files) {
  const errors = [];
  for (const [file, text] of files) {
    const urls = file.endsWith('.html') || file.endsWith('.css')
      ? urlsIn(file, text)
      : [...text.matchAll(JS_ROOT_STRING)].map((m) => m[2]);
    for (const url of urls) {
      if (url.startsWith('/') && !url.startsWith('//')) {
        errors.push(`${file}: root-absolute URL "${url}" (Pages serves the site under /lemma/; use a relative path)`);
      }
    }
  }
  return errors;
}

/**
 * Throws unless `dir` is missing or an empty directory.
 * @param {string} dir
 */
function assertStageTarget(dir) {
  if (!existsSync(dir)) return;
  if (!statSync(dir).isDirectory()) throw new Error(`refusing to stage into ${dir}: it exists and is not a directory`);
  if (readdirSync(dir).length > 0) throw new Error(`refusing to stage into ${dir}: directory exists and is not empty`);
}

/**
 * Copies the publish set from `root` into `dir`, preserving paths. Refuses a
 * directory that exists and is not empty, before copying anything.
 * @param {string} root absolute repo root
 * @param {string[]} publish repo-relative posix paths
 * @param {string} dir
 * @returns {string[]} the staged paths
 */
export function stage(root, publish, dir) {
  assertStageTarget(dir);
  mkdirSync(dir, { recursive: true });
  for (const p of publish) {
    const to = join(dir, ...p.split('/'));
    mkdirSync(join(to, '..'), { recursive: true });
    copyFileSync(join(root, ...p.split('/')), to);
  }
  return [...publish];
}

/** @param {string[]} errors */
function fail(errors) {
  for (const e of errors) console.error(`allowlist: ${e}`);
  console.error(`allowlist: ${errors.length} problem${errors.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const args = process.argv.slice(2);
  const at = args.indexOf('--stage');
  const stageDir = at === -1 ? null : args[at + 1];
  if (at !== -1 && !stageDir) fail(['--stage needs a directory']);
  if (stageDir) {
    try {
      assertStageTarget(resolve(stageDir));
    } catch (e) {
      fail([/** @type {Error} */ (e).message]);
    }
  }

  let json;
  try {
    json = JSON.parse(readFileSync(join(root, 'publish-allowlist.json'), 'utf8'));
  } catch (e) {
    fail([`cannot read publish-allowlist.json: ${/** @type {Error} */ (e).message}`]);
  }
  const shape = checkShape(json);
  if (shape.length) fail(shape);
  const list = /** @type {Allowlist} */ (json);

  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const isFile = (/** @type {string} */ p) => {
    try {
      return statSync(join(root, ...p.split('/'))).isFile();
    } catch {
      return false;
    }
  };
  const errors = checkClassification(tracked, list, isFile);
  const files = new Map(list.publish.filter(isFile).map((p) => [p, readFileSync(join(root, ...p.split('/')), 'utf8')]));
  const publish = new Set(list.publish);
  errors.push(...checkReferences(files, publish), ...checkRootAbsolute(files));
  if (errors.length) fail(errors);

  console.log(
    `allowlist: ${tracked.length} tracked files, all classified: ${list.publish.length} publish, ${list.exclude.length} exclude.`,
  );
  console.log('allowlist: published references resolve inside the publish set; no root-absolute URLs.');
  if (stageDir) {
    const staged = stage(root, list.publish, resolve(stageDir));
    console.log(`allowlist: staged ${staged.length} files into ${stageDir}:`);
    for (const p of staged) console.log(`  ${p}`);
  }
}
