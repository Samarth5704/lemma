// Generator attempt and time distribution. Outside src/core, so performance
// and os are allowed here.
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { generate } from '../src/core/generate.js';
import { mulberry32 } from '../src/core/rng.js';
import { toIndex } from '../src/core/grid.js';

const SEEDS = 500;
const CAP = 5000; // temporary cap for measurement only
const DIFFICULTIES = [
  ['Beginner', { width: 9, height: 9, mines: 10 }],
  ['Intermediate', { width: 16, height: 16, mines: 40 }],
  ['Expert', { width: 30, height: 16, mines: 99 }],
];

/**
 * Nearest-rank percentile: the smallest value with at least p of the sample
 * at or below it.
 * @param {number[]} sorted ascending
 * @param {number} p in (0, 1]
 */
const pct = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];

/** @param {number} x */
const ms = (x) => x.toFixed(2);

console.log(`Node ${process.version}`);
console.log(`CPU  ${os.cpus()[0].model}`);
console.log(`${SEEDS} seeds per difficulty and position (0..${SEEDS - 1}), cap ${CAP}.`);
console.log('First-click positions: centre; edge (middle of the top row); corner (index 0).');
console.log('Percentiles are nearest-rank. Each difficulty is warmed up on 20 other seeds first;');
console.log('the cold column is the very first generation of the run for that size.\n');

/** @param {{ width: number, height: number }} cfg */
const positions = (cfg) => [
  ['centre', toIndex(cfg.width, Math.floor(cfg.width / 2), Math.floor(cfg.height / 2))],
  ['edge', toIndex(cfg.width, Math.floor(cfg.width / 2), 0)],
  ['corner', 0],
];

const rows = [];
for (const [name, cfg] of DIFFICULTIES) {
  for (const [pos, click] of positions(cfg)) {
    const t0 = performance.now();
    generate(cfg, click, mulberry32(0xc01d), CAP);
    const cold = performance.now() - t0;
    for (let s = 0; s < 20; s++) generate(cfg, click, mulberry32(0xfeed0000 + s), CAP);

    const attempts = [];
    const times = [];
    let failures = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const start = performance.now();
      const r = generate(cfg, click, mulberry32(seed), CAP);
      times.push(performance.now() - start);
      attempts.push(r.attempts);
      if (!r.ok) failures++;
    }
    const firstTry = attempts.filter((a) => a === 1).length;
    attempts.sort((a, b) => a - b);
    times.sort((a, b) => a - b);
    rows.push({
      name,
      pos,
      att: [pct(attempts, 0.5), pct(attempts, 0.95), attempts[attempts.length - 1]],
      first: (100 * firstTry) / SEEDS,
      t: [pct(times, 0.5), pct(times, 0.95), times[times.length - 1]],
      cold,
      failures,
    });
  }
}

console.log('| Difficulty   | Position | Attempts med | p95 | max | 1st attempt | ms med | ms p95 | ms max | cold ms | Failures at cap |');
console.log('|--------------|----------|-------------:|----:|----:|------------:|-------:|-------:|-------:|--------:|----------------:|');
for (const r of rows) {
  console.log(
    `| ${r.name.padEnd(12)} | ${r.pos.padEnd(8)} | ${String(r.att[0]).padStart(12)} | ${String(r.att[1]).padStart(3)} | ${String(r.att[2]).padStart(3)} ` +
    `| ${(r.first.toFixed(1) + '%').padStart(11)} | ${ms(r.t[0]).padStart(6)} | ${ms(r.t[1]).padStart(6)} | ${ms(r.t[2]).padStart(6)} ` +
    `| ${ms(r.cold).padStart(7)} | ${String(r.failures).padStart(15)} |`,
  );
}

// Decision rule: applies to the worst of the three positions on Expert.
const expert = rows.filter((r) => r.name === 'Expert');
const worst = expert.reduce((w, r) => (r.t[1] > w.t[1] ? r : w));
const maxAttempts = Math.max(...expert.map((r) => r.att[2]));
console.log(`\nDecision rule (worst Expert position): ${worst.pos} p95 = ${ms(worst.t[1])} ms, ` +
  `${worst.t[1] < 150 ? 'under 150 ms: keep rerolling' : 'NOT under 150 ms: stop; do not implement perturbation until discussed'}.`);
console.log(`Cap check: worst Expert max attempts ${maxAttempts} x 4 = ${maxAttempts * 4}.`);
