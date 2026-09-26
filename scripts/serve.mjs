// Static dev server for browser checks: ES modules do not load from file://.
// node:http only, bound to 127.0.0.1, serving files under the repo root.
// Usage: npm run serve  (PORT=8080 by default)
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
});

/** @param {string} file */
export function mimeType(file) {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Maps a request path to a file under `root`, or null if it must be refused:
 * anything that is not a rooted path, does not decode, contains a backslash,
 * a null byte or a colon, has a `.` or `..` segment or any dot-segment (so
 * .git and other dotfiles are never served), or resolves outside the root.
 * A path ending in / maps to its index.html.
 * @param {string} root absolute
 * @param {string} urlPath the request target, possibly with ?query or #hash
 * @returns {string | null}
 */
export function resolveRequest(root, urlPath) {
  const raw = urlPath.split(/[?#]/, 1)[0];
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (/[\\\0:]/.test(decoded)) return null;
  const segments = decoded.split('/').slice(1);
  if (segments.slice(0, -1).some((s) => s === '')) return null;
  if (segments.some((s) => s.startsWith('.'))) return null;
  const rel = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const full = resolve(root, `.${rel}`);
  const back = relative(root, full);
  if (back === '' || back.startsWith('..') || isAbsolute(back)) return null;
  return full;
}

/**
 * @param {string} root
 * @param {number} port
 */
export function serve(root, port) {
  const server = createServer(async (req, res) => {
    const refuse = (/** @type {number} */ code, /** @type {string} */ msg) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(msg);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(405, 'Method not allowed');
    const file = resolveRequest(root, req.url ?? '/');
    if (file === null) return refuse(403, 'Forbidden');
    try {
      // Follow symlinks, then check again that the target is under the root.
      const real = await realpath(file);
      const realRoot = await realpath(root);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return refuse(403, 'Forbidden');
      const info = await stat(real);
      if (!info.isFile()) return refuse(404, 'Not found');
      res.writeHead(200, {
        'Content-Type': mimeType(real),
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(real).pipe(res);
    } catch {
      refuse(404, 'Not found');
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Lemma dev server: http://127.0.0.1:${port}/`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  serve(root, Number(process.env.PORT) || 8080);
}
