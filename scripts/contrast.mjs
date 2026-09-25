// Contrast and token checks for styles/tokens.css. Reads the file as shipped,
// prints a table per theme, and exits 1 on any miss.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const COLOUR_TOKENS = [
  '--bg', '--text', '--text-muted', '--grid-line',
  '--cell-covered', '--cell-covered-edge', '--cell-pressed', '--cell-revealed',
  ...Array.from({ length: 8 }, (_, k) => `--proof-${k}`),
  ...Array.from({ length: 8 }, (_, k) => `--num-${k + 1}`),
  '--glyph-flag', '--glyph-wrong-flag', '--cell-mine', '--glyph-mine',
  '--cell-detonated', '--glyph-detonated', '--focus-ring', '--focus-halo', '--clue-outline',
  '--num-proof',
];
export const BASE_TOKENS = ['--cell-size', '--gap', '--radius', '--font-ui', '--font-num'];

const BANDS = Array.from({ length: 8 }, (_, k) => `--proof-${k}`);
const NUMS = Array.from({ length: 8 }, (_, k) => `--num-${k + 1}`);
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_BAND_CHROMA = 0.06;
const MIN_BAND_DELTA_E = 0.03;
const MIN_NUM_DELTA_E = 0.08;

/** @param {string} hex #rrggbb @returns {[number, number, number]} channels in [0, 1] */
export function hexToRgb(hex) {
  if (!HEX.test(hex)) throw new Error(`not a 6-digit hex: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * sRGB channel to linear light, as in the WCAG 2.x relative luminance
 * definition. No 8-bit value lies between 0.03928 and IEC 61966-2-1's 0.04045,
 * so this is also the sRGB transfer function for every hex colour.
 * @param {number} c
 */
const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2.x relative luminance. @param {string} hex */
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, symmetric in its arguments. @param {string} a @param {string} b */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Hex to OKLab. The matrices are Björn Ottosson's linear_srgb_to_oklab, copied
 * from https://bottosson.github.io/posts/oklab/ (fetched for this file; the
 * post notes the matrices were updated 2021-01-25).
 * @param {string} hex
 * @returns {{ L: number, a: number, b: number }}
 */
export function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

/** Euclidean distance in OKLab. @param {string} x @param {string} y */
export function deltaE(x, y) {
  const p = hexToOklab(x);
  const q = hexToOklab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** @param {string} hex */
export const chroma = (hex) => {
  const { a, b } = hexToOklab(hex);
  return Math.hypot(a, b);
};

/**
 * Blanks out comments while keeping line breaks, so line structure survives.
 * @param {string} css
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

/**
 * Top-level `selector { body }` rules; nested braces (an @media) are kept in
 * the body.
 * @param {string} css
 * @returns {{ selector: string, body: string }[]}
 */
function rules(css) {
  /** @type {{ selector: string, body: string }[]} */
  const out = [];
  let depth = 0;
  let selStart = 0;
  let bodyStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        const selector = css.slice(selStart, bodyStart - 1).trim().replace(/\s+/g, ' ');
        out.push({ selector, body: css.slice(bodyStart, i) });
        selStart = i + 1;
      }
    }
  }
  return out;
}

/**
 * Parses one-token-per-line declarations.
 * @param {string} body
 * @param {string} where label used in failure messages
 * @param {string[]} failures
 * @returns {Map<string, string>}
 */
function declarations(body, where, failures) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^(--[a-z0-9-]+)\s*:\s*([^;]+?)\s*;$/i.exec(line);
    if (!m) {
      failures.push(`${where}: not one token per line: ${line}`);
      continue;
    }
    if (map.has(m[1])) failures.push(`${where}: duplicate token ${m[1]}`);
    map.set(m[1], m[2]);
  }
  return map;
}

const LIGHT_SEL = ':root, [data-theme="light"]';
const DARK_SEL = '[data-theme="dark"]';
const MEDIA_SEL = '@media (prefers-color-scheme: dark)';
const MEDIA_INNER_SEL = ':root:not([data-theme="light"])';

/**
 * Finds the base, light, dark and media-dark blocks.
 * @param {string} cssText
 * @param {string[]} failures
 */
export function parseTokens(cssText, failures = []) {
  const css = stripComments(cssText);
  const top = rules(css);
  /** @param {string} sel @param {{ selector: string, body: string }[]} list */
  const find = (sel, list) => {
    const hits = list.filter((r) => r.selector === sel);
    if (hits.length === 0) failures.push(`missing block: ${sel}`);
    if (hits.length > 1) failures.push(`more than one block: ${sel}`);
    return hits[0];
  };
  const base = find(':root', top);
  const light = find(LIGHT_SEL, top);
  const dark = find(DARK_SEL, top);
  const media = find(MEDIA_SEL, top);
  const inner = media ? find(MEDIA_INNER_SEL, rules(media.body)) : undefined;
  return {
    base: base ? declarations(base.body, 'base', failures) : new Map(),
    light: light ? declarations(light.body, 'light', failures) : new Map(),
    dark: dark ? declarations(dark.body, 'dark', failures) : new Map(),
    darkMedia: inner ? declarations(inner.body, 'dark (media)', failures) : new Map(),
  };
}

/** @param {number} x */
const r2 = (x) => x.toFixed(2);
/** @param {number} x */
const r3 = (x) => x.toFixed(3);
/** @param {number} x */
const r4 = (x) => x.toFixed(4);
/** @param {string} s @param {number} n */
const pad = (s, n) => s.padEnd(n);
/** @param {string} s @param {number} n */
const lpad = (s, n) => s.padStart(n);
/** @param {string} t */
const short = (t) => t.replace(/^--/, '');

/**
 * Runs every check on the stylesheet text.
 * @param {string} cssText contents of tokens.css
 * @returns {{ failures: string[], lines: string[] }}
 */
export function checkTokens(cssText) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const lines = [];
  const blocks = parseTokens(cssText, failures);

  // Hex-only rule: no colour function may appear anywhere in the file.
  const fn = /\b(oklch|oklab|lch|lab|rgba?|hsla?|hwb|color-mix|color)\(/i.exec(stripComments(cssText));
  if (fn) failures.push(`colour function in tokens.css: ${fn[1]}()`);

  for (const t of BASE_TOKENS) {
    if (!blocks.base.has(t)) failures.push(`base: missing token ${t}`);
  }
  const size = blocks.base.get('--cell-size');
  if (size !== undefined) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(size);
    if (!m || Number(m[1]) < 44) failures.push(`base: --cell-size must be at least 44px, got ${size}`);
  }

  // The two dark blocks must be identical.
  const d1 = blocks.dark;
  const d2 = blocks.darkMedia;
  for (const t of new Set([...d1.keys(), ...d2.keys()])) {
    if (d1.get(t) !== d2.get(t)) {
      failures.push(
        `dark blocks differ: ${t} ([data-theme="dark"] ${d1.get(t) ?? 'absent'}, media ${d2.get(t) ?? 'absent'})`,
      );
    }
  }

  for (const [name, map] of /** @type {[string, Map<string, string>][]} */ ([
    ['light', blocks.light],
    ['dark', blocks.dark],
    ['dark (media)', blocks.darkMedia],
  ])) {
    for (const t of COLOUR_TOKENS) {
      if (!map.has(t)) failures.push(`${name}: missing token ${t}`);
    }
    for (const [t, v] of map) {
      if (!HEX.test(v)) failures.push(`${name}: ${t} is not a 6-digit hex: ${v}`);
    }
  }

  for (const [name, map] of /** @type {['light' | 'dark', Map<string, string>][]} */ ([
    ['light', blocks.light],
    ['dark', blocks.dark],
  ])) {
    themeReport(name, map, failures, lines);
  }

  lines.push('');
  lines.push(failures.length === 0 ? 'All checks passed.' : `${failures.length} failure(s):`);
  for (const f of failures) lines.push(`  ✗ ${f}`);
  return { failures, lines };
}

/**
 * Contrast and band checks for one theme. Pairs with a missing or non-hex
 * token are skipped; those are already reported as failures.
 * @param {'light' | 'dark'} theme
 * @param {Map<string, string>} map
 * @param {string[]} failures
 * @param {string[]} lines
 */
function themeReport(theme, map, failures, lines) {
  /** @param {string} t */
  const ok = (t) => HEX.test(map.get(t) ?? '');
  /** @param {string} t */
  const hex = (t) => /** @type {string} */ (map.get(t));
  const mark = (/** @type {boolean} */ pass) => (pass ? 'pass' : 'FAIL');

  /**
   * One required pair, as a table row.
   * @param {string} section
   * @param {string} fg
   * @param {string} bg
   * @param {number} min
   */
  const pair = (section, fg, bg, min) => {
    if (!ok(fg) || !ok(bg)) return;
    const r = contrastRatio(hex(fg), hex(bg));
    const pass = r >= min;
    lines.push(`  ${pad(short(fg), 18)} on ${pad(short(bg), 16)} ${lpad(r2(r), 6)}  ${mark(pass)}`);
    if (!pass) failures.push(`${theme}: ${section}: ${fg} on ${bg} is ${r2(r)}, needs ${min}`);
  };

  lines.push('');
  lines.push(`==================== ${theme.toUpperCase()} ====================`);

  // 1. Numbers: 4.5 on revealed, the only surface they appear on during play.
  // On a won board digits render in --num-proof, so band ratios are report-only.
  const surfaces = ['--cell-revealed', ...BANDS];
  lines.push('');
  lines.push('1. Numbers on revealed (min 4.5); on bands (report only: digits use --num-proof there)');
  lines.push(
    `  ${pad('', 8)}${pad('hex', 9)}${surfaces.map((s) => lpad(s === '--cell-revealed' ? 'revealed' : short(s).replace('proof-', 'p'), 9)).join('')}`,
  );
  lines.push(
    `  ${pad('', 17)}${surfaces.map((s) => lpad(ok(s) ? hex(s) : '?', 9)).join('')}`,
  );
  /** @type {{ n: string, r: number } | null} */
  let binding = null;
  for (const n of NUMS) {
    if (!ok(n)) continue;
    const rs = surfaces.map((s) => (ok(s) ? contrastRatio(hex(n), hex(s)) : NaN));
    const onRevealed = rs[0];
    const pass = onRevealed >= 4.5;
    lines.push(
      `  ${pad(short(n), 8)}${pad(hex(n), 9)}${rs.map((r) => lpad(Number.isNaN(r) ? '?' : r2(r), 9)).join('')}  ${Number.isNaN(onRevealed) ? '?' : mark(pass)}`,
    );
    if (Number.isNaN(onRevealed)) continue;
    if (!pass) failures.push(`${theme}: number ${n} on --cell-revealed is ${r2(onRevealed)}, needs 4.5`);
    if (binding === null || onRevealed < binding.r) binding = { n, r: onRevealed };
  }
  if (binding) lines.push(`  binding: ${short(binding.n)} on cell-revealed at ${r2(binding.r)}`);

  // 1b. Numbers must stay distinguishable from each other, not only from the surface.
  lines.push('');
  lines.push(`1b. Number separation: OKLab ΔE between every pair (min ${MIN_NUM_DELTA_E})`);
  lines.push(`  ${pad('', 7)}${NUMS.map((n) => lpad(short(n).replace('num-', '') + ' ', 8)).join('')}   (* below floor)`);
  /** @type {{ a: string, b: string, d: number } | null} */
  let closest = null;
  for (const a of NUMS) {
    const cells = NUMS.map((b) => {
      if (a === b) return lpad('— ', 8);
      if (!ok(a) || !ok(b)) return lpad('? ', 8);
      const d = deltaE(hex(a), hex(b));
      return lpad(r3(d) + (d < MIN_NUM_DELTA_E ? '*' : ' '), 8);
    });
    lines.push(`  ${pad(short(a), 7)}${cells.join('')}`);
  }
  NUMS.forEach((a, i) => {
    for (const b of NUMS.slice(i + 1)) {
      if (!ok(a) || !ok(b)) continue;
      const d = deltaE(hex(a), hex(b));
      if (closest === null || d < closest.d) closest = { a, b, d };
      if (d < MIN_NUM_DELTA_E) {
        failures.push(`${theme}: numbers ${a} and ${b} differ by ΔE ${r3(d)}, needs ${MIN_NUM_DELTA_E}`);
      }
    }
  });
  if (closest) {
    lines.push(`  closest: ${short(closest.a)} / ${short(closest.b)} at ΔE ${r3(closest.d)}  ${mark(closest.d >= MIN_NUM_DELTA_E)}`);
  }

  // 1c. The single proof-map ink on every band.
  lines.push('');
  lines.push('1c. --num-proof on every proof band (min 4.5)');
  for (const b of BANDS) pair('num-proof', '--num-proof', b, 4.5);

  // 2. Glyphs.
  lines.push('');
  lines.push('2. Glyphs on their cell (min 3)');
  pair('glyph', '--glyph-flag', '--cell-covered', 3);
  pair('glyph', '--glyph-wrong-flag', '--cell-covered', 3);
  pair('glyph', '--glyph-mine', '--cell-mine', 3);
  pair('glyph', '--glyph-detonated', '--cell-detonated', 3);

  // 3. Two-tone focus: ring against halo, then the better tone per surface.
  lines.push('');
  lines.push('3. Focus ring + halo: ring vs halo (min 3); per surface, max of the two (min 3)');
  if (ok('--focus-ring') && ok('--focus-halo')) {
    const rh = contrastRatio(hex('--focus-ring'), hex('--focus-halo'));
    lines.push(`  ${pad('focus-ring', 18)} vs ${pad('focus-halo', 16)} ${lpad(r2(rh), 6)}  ${mark(rh >= 3)}`);
    if (rh < 3) failures.push(`${theme}: focus: --focus-ring vs --focus-halo is ${r2(rh)}, needs 3`);
    lines.push(`  ${pad('surface', 18)}${lpad('ring', 8)}${lpad('halo', 8)}  carried by`);
    for (const s of ['--bg', '--cell-covered', '--cell-pressed', '--cell-revealed', ...BANDS, '--cell-mine', '--cell-detonated']) {
      if (!ok(s)) continue;
      const ring = contrastRatio(hex('--focus-ring'), hex(s));
      const halo = contrastRatio(hex('--focus-halo'), hex(s));
      const pass = Math.max(ring, halo) >= 3;
      const by = ring >= 3 && halo >= 3 ? 'both' : ring >= 3 ? 'ring' : halo >= 3 ? 'halo' : 'neither';
      lines.push(`  ${pad(short(s), 18)}${lpad(r2(ring), 8)}${lpad(r2(halo), 8)}  ${pad(by, 8)}  ${mark(pass)}`);
      if (!pass) failures.push(`${theme}: focus: neither tone reaches 3 on ${s} (ring ${r2(ring)}, halo ${r2(halo)})`);
    }
  }

  // 4. Clue outline.
  lines.push('');
  lines.push('4. Clue outline (min 3)');
  for (const s of ['--cell-revealed', ...BANDS]) pair('clue outline', '--clue-outline', s, 3);

  // 5. Covered against revealed; against bands, report only.
  lines.push('');
  lines.push('5. Covered against revealed (min 3); against bands (report only)');
  pair('covered', '--cell-covered', '--cell-revealed', 3);
  for (const s of BANDS) {
    if (!ok('--cell-covered') || !ok(s)) continue;
    const r = contrastRatio(hex('--cell-covered'), hex(s));
    lines.push(`  ${pad('cell-covered', 18)} on ${pad(short(s), 16)} ${lpad(r2(r), 6)}  (report)`);
  }

  // 6. Covered edge against every band, so flagged mines on a won board keep a boundary.
  lines.push('');
  lines.push('6. Covered edge against every proof band (min 3)');
  for (const s of BANDS) pair('covered edge', '--cell-covered-edge', s, 3);

  // 7. Text.
  lines.push('');
  lines.push('7. Text on page background (min 4.5)');
  pair('text', '--text', '--bg', 4.5);
  pair('text', '--text-muted', '--bg', 4.5);

  // 8. Bands: monotonic OKLab L, adjacent ΔE, chroma cap.
  lines.push('');
  const dir = theme === 'light' ? 'decreasing' : 'increasing';
  lines.push(`8. Proof bands: OKLab L strictly ${dir}; adjacent ΔE ≥ ${MIN_BAND_DELTA_E}; chroma ≤ ${MAX_BAND_CHROMA}`);
  lines.push(`  ${pad('band', 9)}${pad('hex', 9)}${lpad('L', 7)}${lpad('a', 8)}${lpad('b', 8)}${lpad('C', 7)}${lpad('ΔL', 9)}${lpad('ΔE', 8)}`);
  if (!BANDS.every(ok)) return;
  const labs = BANDS.map((t) => hexToOklab(hex(t)));
  BANDS.forEach((t, k) => {
    const { L, a, b } = labs[k];
    const C = Math.hypot(a, b);
    let tail = '';
    if (k > 0) {
      const dL = L - labs[k - 1].L;
      const dE = deltaE(hex(BANDS[k - 1]), hex(t));
      const mono = theme === 'light' ? dL < 0 : dL > 0;
      tail = `${lpad((dL >= 0 ? '+' : '') + r4(dL), 9)}${lpad(r4(dE), 8)}  ${mark(mono && dE >= MIN_BAND_DELTA_E)}`;
      if (!mono) failures.push(`${theme}: band L not strictly ${dir} from ${BANDS[k - 1]} to ${t} (ΔL ${r3(dL)})`);
      if (dE < MIN_BAND_DELTA_E) failures.push(`${theme}: ΔE ${BANDS[k - 1]} to ${t} is ${r3(dE)}, needs ${MIN_BAND_DELTA_E}`);
    }
    if (C > MAX_BAND_CHROMA) failures.push(`${theme}: ${t} chroma ${r3(C)} exceeds ${MAX_BAND_CHROMA}`);
    lines.push(
      `  ${pad(short(t), 9)}${pad(hex(t), 9)}${lpad(r3(L), 7)}${lpad(r3(a), 8)}${lpad(r3(b), 8)}${lpad(r3(C), 7)}${tail}`,
    );
  });
}

function main() {
  const path = new URL('../styles/tokens.css', import.meta.url);
  const { failures, lines } = checkTokens(readFileSync(path, 'utf8'));
  console.log(lines.join('\n'));
  process.exitCode = failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
