# Lemma: Minesweeper where every board is provable

## The idea

Random Minesweeper is unfair in a specific, well-known way: most boards
eventually force a coin-flip, and you lose a game you played perfectly. Lemma
only deals boards that a deductive solver has proven solvable from the first
click without guessing.

Because of that guarantee, the game can be honest when you lose. Every safe
cell has a place in a proof, and Lemma shows it:

- **On a loss**, the board says whether the cell you clicked was provable from
  the clues visible at that moment. If it was, the clues that proved it are
  highlighted and named. If it wasn't, the board names a cell that *was*
  provably safe. The guarantee is what makes this statement true rather than
  a guess.
- **On a win**, the board recolours by deduction step (the proof map). Every
  safe cell is tinted by the step at which the solver first proved it, from
  the opening to the last forced cell. It is the board's logic, drawn.

The visual system is driven by the solver's own output, not by decoration.

## Stack: hard constraints

- Plain HTML, CSS and JavaScript as ES modules. No build step. The site is
  served as the files are written.
- Type checking with `tsc --noEmit` over JSDoc-annotated JS (`checkJs`).
  TypeScript is a dev dependency used only as a checker, never as a compiler.
- Tests use `node:test` and `node:assert/strict`. No test libraries.
- Runtime dependencies: none. Dev dependencies: `typescript` only.
- Rendering uses DOM `<button>` elements, not canvas, because each cell must
  be a real focusable control.

**Forbidden:** any framework, any bundler, jsdom or any DOM emulation,
Math.random / Date / performance / crypto / localStorage / document / window
anywhere in `src/core/`, innerHTML for rendering cells or lists,
long-press gestures, custom drag-to-pan code, copying any code from other
Minesweeper implementations.

## Attribution

- The no-guess generation idea and the "first click opens an area" rule come
  from Simon Tatham's Mines (Portable Puzzle Collection, MIT licence). No code
  is taken from it; the solver and generator here are written independently.
  If the phase 2 measurement forces a switch from rerolling to perturbing the
  grid at the point the solver gets stuck, that is also Tatham's approach and
  gets credited as such.
- Classic Windows Minesweeper moved a first-click mine to the top-left corner
  (visible in the leaked NT 4.0 source). Lemma deliberately does not do this;
  the README says why.
- The difficulty sizes and the number colour convention (1 blue, 2 green,
  3 red …) follow Windows Minesweeper convention. Colours are re-derived to
  pass contrast rather than copied.
- mulberry32 by Tommy Ettinger (2017), public domain via CC0, per the header of gist 46a874533244883189143505d203312c.

## Board sizes

| Name         | Width | Height | Mines |
|--------------|-------|--------|-------|
| Beginner     | 9     | 9      | 10    |
| Intermediate | 16    | 16     | 40    |
| Expert       | 30    | 16     | 99    |

No custom sizes. A config is rejected if `mines > width*height - 9`.

## Non-negotiable technical rules

1. **Pure core.** Everything in `src/core/` is a pure function of its inputs.
   Randomness enters as an injected `rng` function built from a seed. Time
   enters as an explicit `now` argument. A test reads every core file's
   source and fails if it contains `Math.random`, `Date`, `performance`,
   `crypto`, `localStorage`, `document`, or `window`. The core has its own
   tsconfig with `lib: ["ES2022"]` and no DOM lib, so touching the DOM is a
   type error.
2. **Neighbours are computed from (x, y) with bounds checks on each axis,**
   never by adding offsets to a flat index. Flat-index offsets wrap the right
   edge onto the next row's left edge, which is the classic grid bug.
3. **Mines are placed after the first click,** excluding the clicked cell and
   all its neighbours, so the first click is always a zero and always opens an
   area. There is no mine-moving.
4. **Win means every safe cell is revealed.** Flags never appear in the win
   check. When the game is won, the remaining mines are auto-flagged for
   display.
5. **Flood fill is iterative** with a queue and a visited set. It never opens
   flagged cells, and each cell is enqueued at most once.
6. **Chord** acts only when the number of adjacent flags equals the cell's
   number. It trusts flags, so a wrong flag detonates. If the flag count
   differs, it does nothing.
7. **After won or lost, every action is a no-op.**
8. **The mine counter is `mines - flags` and may go negative.** Do not clamp
   it.
9. **The solver must be sound.** Anything it proves is true. It uses only
   revealed numbers. It ignores player flags entirely, and it does not use
   the global mine count. Because of this, it will reject some solvable
   boards. That is accepted: it keeps the solver small and the guarantee
   strict. The README states this.
10. **Derived values are never stored.** The proof trace is recomputed from
    (mines, first click) on load, as are elapsed time and the mine counter.
11. **The generator has a hard attempt cap** and returns `{ ok: false }` when
    the cap is exhausted. It never loops unbounded.
12. **One store owns all state and persistence;** views subscribe. The store
    emits the set of changed cell indices, and the grid updates only those
    buttons. The grid is built once per board. Cells are never re-rendered
    with innerHTML.
13. **Persistence is versioned** under one localStorage key with a
    `migrate()` function from day one. Loading validates and falls back to
    defaults. On an unknown future version, the app runs on defaults in memory
    and never writes, so a newer save is not overwritten. Every storage call
    is wrapped in try/catch; the app must work with storage unavailable.

## File layout

```
index.html
styles/tokens.css        colour, spacing, type tokens (light + dark)
styles/app.css
src/core/grid.js         dimensions, index<->xy, neighbours, computeCounts, flood
src/core/rng.js          mulberry32(seed) -> () => float in [0,1)
src/core/rules.js        newGame, reveal, flag, chord, status, elapsed, counter
src/core/solver.js       visibleClues(game), deduce(width, height, clues) to fixpoint
src/core/generate.js     generate(config, firstClick, rng, cap)
src/core/proof.js        buildProof -> per-cell step, rule, clues; explainLoss()
src/store.js             createStore: state, dispatch, subscribe, derived proof/loss
src/persist.js           load, save, migrate, restoreGame, DIFFICULTIES
src/view/grid.js         board DOM, roving focus, input events
src/view/names.js        cellView and cellName (pure, tested without a DOM)
src/view/keys.js         nextFocus and activationFor (pure)
src/view/hud.js          counter, timer, flag-mode toggle, difficulty, new game
src/view/result.js       loss explanation, win summary, proof table
src/main.js
test/*.test.js
scripts/measure.mjs      generator attempt/time distribution
scripts/contrast.mjs     WCAG ratio checks from tokens.css, fails on miss
scripts/serve.mjs        static dev server on 127.0.0.1 (phase 3b; browser checks)
scripts/allowlist.mjs    publish allowlist check, fails on unclassified file
publish-allowlist.json   every tracked file, by exact path, as publish or exclude
.github/workflows/ci.yml     gates on PRs and pushes to main (phase 4)
.github/workflows/deploy.yml gates, stage the publish set, deploy to Pages
docs/spec.md             this file
docs/tokens-preview.html token review page (phase 3a; not published)
```

## Phases

Logic first, UI last. Each phase ends at a stop point: run everything, report,
and wait. Do not start the next phase.

### Phase 1: Rules core

**Goal:** a complete, pure, tested Minesweeper rules engine. At this stage the
generator places random mines without the no-guess check; the no-guess check
arrives in phase 2. This phase also sets up the tooling: `package.json`
scripts, the two tsconfigs (core without DOM, app with DOM), and the
forbidden-identifier test.

**Tests (write them before the implementation):**

- A cell at x = width-1 does not list x = 0 of the next row as a neighbour.
  A cell at x = 0 does not list x = width-1 of the previous row.
- Corner cells have 3 neighbours, edge cells have 5, and interior cells
  have 8.
- For 1000 seeds on Expert, no mine lands on the first-click cell or any of
  its neighbours, and the mine count is exactly 99.
- A first click in a corner excludes only 4 cells, and the mine count is
  still exact.
- The same seed and the same first click produce an identical board.
- A config with `mines > cells - 9` is rejected.
- A flood from a zero stops at numbered cells and does not open a flagged
  cell inside the region.
- A flood enqueues each cell at most once. Count the enqueues on a 30×16
  board with one mine in a corner.
- The same flood completes without recursion. Assert that `rules.js` uses no
  recursive calls, or run it on a 200×200 board inside the test only.
- Revealing a flagged cell is a no-op.
- Flagging a revealed cell is a no-op.
- Chord with fewer flags than the number is a no-op.
- Chord with more flags than the number is a no-op.
- Chord with correct flags opens every remaining covered neighbour. Build a
  board where the covered neighbours are not connected by any zero, and
  assert that precondition in the test. Otherwise, the first reveal can
  flood-win the board and the test passes vacuously.
- Chord with a wrong flag loses. The detonated index is the mine that was
  revealed.
- A chord that reaches a zero cascades its flood.
- Revealing the last safe cell wins with zero flags placed.
- Flagging every mine while safe cells remain covered does not win.
- A first click whose flood reveals every safe cell ends the game as won
  immediately.
- Reveal, flag and chord after a win are all no-ops; the same holds after a
  loss.
- The counter reads −1 with 11 flags on Beginner.
- Elapsed time is 0 before the first click, accumulates across a pause and
  resume, and never decreases as `now` increases.

**Stop.** Report: number of tests, any bug found during the session, and the
named regression test for it.

### Phase 2: Solver, no-guess generator, proof trace

**Goal:** a sound deductive solver, a generator that only returns boards the
solver can clear from the first click, and a proof trace per safe cell.

Solver rules, applied to a fixpoint over the revealed numbers only:

- **Single-clue rule.** Take a number n with k known-mine neighbours and u
  unknown neighbours. If n − k = 0, all u are safe. If n − k = u, all u are
  mines.
- **Subset rule.** For two clues whose unknown sets satisfy A ⊆ B, the cells in
  B∖A contain n_B − n_A mines. If that equals 0, they're safe; if it equals
  |B∖A|, they're mines.

Dependency direction: `grid <- solver <- proof <- generate <- rules`, with no
cycles. `proof.js` describes the game objects it reads structurally rather than
importing the `Game` type from `rules.js`.

**Clue view (decided in phase 2).** `visibleClues(game)` in `solver.js`
returns an `Int8Array`: the adjacent-mine count for each revealed cell, and −1
for every covered and every flagged cell. A detonated mine is not a number, so
it also reads −1. `deduce(width, height, clues)` takes only this array. The
solver never receives mines or hidden counts, so soundness and "ignores flags"
hold by construction.

`deduce` applies the single-clue rule and the subset rule to a fixpoint.
Cells decided earlier in the same call count as known. The subset rule only
compares clue pairs within Chebyshev distance 2, since unknown sets cannot
overlap beyond that. It returns
`{ safe: number[], mines: number[], why: Map<cell, { rule: 'single' | 'subset', clues: number[], deps: number[] }> }`.
`safe` and `mines` are ascending. `clues` holds the indices of the numbers the
rule was applied to: one for `'single'`, two for `'subset'`. `deps` holds the
cells decided earlier in the same call whose status the rule relied on (the
decided covered neighbours of the clues used), ascending. Both are direct
pointers: `deduce` never merges sets transitively, so generation does not pay
for chains. `explainChain(why, cell)` in `proof.js` walks `deps`
transitively and returns every number involved, ascending. Only `explainLoss`
calls it; `buildProof` and `generate` never do. The interleaved timing check
showed that recording `deps` changed Expert p95 by −3.2% / +3.3% / +2.6%
(centre / edge / corner), within the 10% limit, so it is always on.

**No module state (decided in phase 2).** `src/core` holds no module-level
mutable state; a test enforces this. The neighbour table
(`neighbourTable(width, height)` in `solver.js`) is built once per
`generate()` call and passed down to `buildProof` and `deduce` as an optional
last argument. A direct `buildProof` or `deduce` call builds its own.

**Proof trace (decided in phase 2).** `buildProof(width, height, mines,
firstClick)` in `proof.js` simulates play. Step 0 floods the first click. Each
later step runs `deduce`, reveals every proven-safe cell with flood, and
increments the step. It stops when all safe cells are revealed
(`solved: true`) or when `deduce` proves no safe cell (`solved: false`). It
records, per cell:

- `stepOf` (`Int16Array`, −1 for mines and unreached cells);
- `ruleOf`: `'opening'` (the first click only), `'single'`, `'subset'`,
  `'flood'`, or `null`;
- `cluesOf`: the rule's clues for `'single'` and `'subset'`; for `'flood'`, a
  one-element array holding the zero that opened the cell; `[]` for
  `'opening'`; `null` where the rule is `null`.

A cell opened by a cascade gets `'flood'` and the step of the reveal that
triggered it, including cells in the first click's own flood. It never
inherits the triggering cell's rule. The trace also returns
`summary: { steps, singleCells, subsetCells, floodCells }`, where `steps` is
the last step reached.

**Generator.** `generate(config, firstClick, rng, cap)` loops `placeMines`
(one rng stream across attempts) and then `buildProof`. It returns
`{ ok: true, mines, attempts }` on the first solved board, or
`{ ok: false, attempts: cap }`. The same seed and first click give an
identical result. On the first reveal, `rules.js` calls
`generate(config, i, mulberry32(seed), GENERATE_CAP)`. On `{ ok: false }` it
falls back to `placeMines(config, i, mulberry32(seed))`. That board is not
guaranteed, which is derivable from `buildProof(...).solved`, so nothing
extra is stored.

**`GENERATE_CAP = 1100`.** The measurement below, over all three first-click
positions, saw at most 257 attempts for an Expert board (corner). Four times
that is 1028, rounded up to 1100. The earlier centre-only measurement had set
it to 1000 (173 × 4 = 692).

**`lossAction` (decided in phase 2).** `Game` has
`lossAction: number | null`. It is null until a loss. On a loss it holds the
index the player acted on: the clicked cell for a reveal, or the chorded
number for a chord. Like the rest of a loss, it changes no cell other than
the detonated index.

**`explainLoss(state)` (decided in phase 2)** is in `proof.js` and takes a
lost state only. It throws otherwise.

- **Reveal loss:** it builds the clues from the state with the detonated cell
  treated as covered, which is exactly the pre-click state because a loss
  changes cells only at the detonated index. It runs `deduce` and returns
  one of:
  - `{ kind: 'reveal', provable: 'mine', clues }` when the clicked cell was
    provably a mine;
  - `{ kind: 'reveal', provable: 'no', safe, clues }` otherwise. `safe` is
    the provably safe cell nearest the clicked one (Chebyshev distance, ties
    broken by the lowest index);
  - `{ kind: 'reveal', provable: 'none' }` when nothing was provable, which
    can only happen on an ungenerated fallback board.

  In the `'mine'` and `'no'` results, `clues` is `explainChain` of the clicked
  or named cell: every number the proof used, including the upstream numbers
  behind cells it relied on, not just the last one.
- **Chord loss:** the player did not guess the detonated cell; a flag the
  chord trusted was wrong. It returns
  `{ kind: 'chord', chorded, wrongFlags, detonated }`. `wrongFlags` holds the
  chorded number's flagged neighbours that are not mines, ascending. Reading
  mines is allowed here because this is a post-mortem, not a deduction.

**Tests:**

- Soundness over 2000 seeded random boards and random partial states: every
  cell proven safe is safe, and every cell proven mine is a mine.
- A "1" with exactly one covered neighbour proves that neighbour is a mine.
- The 1-1 pattern against a wall proves the third cell safe.
- The 1-2 pattern against a wall proves the correct mine.
- A symmetric 50/50 (two cells, one mine, no other information) is reported
  as stuck.
- An endgame that only the global mine count can resolve is reported as
  stuck, and the generator rejects that board. This documents rule 9.
- A wrong player flag in the state does not change any deduction.
- For 200 seeds per difficulty, every generated board is cleared by
  `buildProof` from its first click.
- An impossible config returns `{ ok: false }` after exactly `cap` attempts.
  The config must be one where success is impossible by argument, not a seed
  that happened to fail. The test uses 10×2 with 5 mines, and the argument is
  in the test.
- In the proof trace, every safe cell has exactly one step, and every clue
  cited at step s was revealed at a step before s.
- **The loss invariant.** For 200 generated boards, a simulated player
  reveals random safe cells (any safe cell, including lucky guesses). At every
  point before the win, `deduce` proves at least one covered cell safe. This
  is the property that makes the loss screen truthful, so it is tested, not
  asserted.
- `explainLoss` returns `provable: 'mine'` with the correct clues for a click
  on a deducible mine. It returns `provable: 'no'` and a genuinely safe cell
  for a click on a non-deducible mine.
- `explainLoss` cites the upstream number when a mine is proved through a
  chain. The same holds for the named safe cell in a `'no'` result.
- The first reveal on a board no generator can solve falls back and is not
  guaranteed. This runs through the real `newGame`/`reveal` path.
- No `src/core` file holds module-level mutable state.

**Measurement (`scripts/measure.mjs`):** for 500 seeds per difficulty and
per first-click position, report attempts per board (median, p95, max), the
share generated on the first attempt, generation time in ms (median, p95,
max), and failures at the cap, under Node. The positions are the centre, the
edge (the middle of the top row), and the corner (index 0).

**Stop.** Report the measurement table. Decision rule, applied to the worst
of the three positions (the original rule was centre-only, which understated
the worst case: corners need the most attempts):

- If Expert p95 is under 150 ms at every position, keep rerolling.
- Otherwise, stop and do not implement perturbation until it has been
  discussed. Phones are slower than the machine that measured, so the
  margin matters.

**Measured (phase 2).** Node v24.19.0 on an Intel Core i5-10210U @ 1.60GHz,
running on battery (discharging, 13–20% charge). 500 seeds per difficulty and
position, temporary cap 5000, nearest-rank percentiles, and a 20-board warm-up
per size and position before timing.

| Difficulty   | Position | Attempts median | p95 | max | First attempt | ms median | ms p95 | ms max | Failures at cap |
|--------------|----------|----------------:|----:|----:|--------------:|----------:|-------:|-------:|----------------:|
| Beginner     | centre   |               1 |   2 |   5 |         80.6% |      0.16 |   1.10 |   4.84 |               0 |
| Beginner     | edge     |               1 |   2 |   4 |         80.4% |      0.12 |   0.31 |   0.63 |               0 |
| Beginner     | corner   |               1 |   3 |   5 |         72.6% |      0.17 |   0.43 |   0.76 |               0 |
| Intermediate | centre   |               1 |   5 |   9 |         55.8% |      0.74 |   2.20 |   4.62 |               0 |
| Intermediate | edge     |               1 |   5 |   9 |         50.2% |      1.17 |   3.57 |   7.52 |               0 |
| Intermediate | corner   |               2 |   6 |   9 |         42.6% |      0.86 |   2.47 |   5.75 |               0 |
| Expert       | centre   |              18 |  73 | 173 |          4.8% |     29.85 | 136.17 | 316.07 |               0 |
| Expert       | edge     |              18 |  71 | 211 |          4.6% |     31.26 | 134.10 | 371.91 |               0 |
| Expert       | corner   |              20 |  96 | 257 |          3.4% |     23.02 | 112.53 | 397.95 |               0 |

The worst Expert p95 is 136.17 ms (centre), under 150 ms, so rerolling stays.
The margin is thin and the timing is noisy on this machine. The same code
measured 55.94 ms at the centre on mains power the day before, and an earlier
battery run gave 152.42 ms, just over the line. Attempt counts are
deterministic for these seeds, so they, and GENERATE_CAP, do not depend on
the machine. Remeasure on mains power before treating 150 ms as settled.

### Phase 3a: Design tokens: review checkpoint

**Goal:** `styles/tokens.css` for light and dark themes, plus
`scripts/contrast.mjs`, which parses the tokens and fails the process on any
miss.

The tokens cover:

- surfaces for covered, revealed, and pressed cells;
- the eight number colours;
- flag, mine, detonated-mine, and wrong-flag glyph colours;
- the two-tone focus indicator (ring and halo);
- the loss-clue outline;
- eight discrete proof-map bands, `--proof-0` to `--proof-7`.

Use discrete bands, not `color-mix`, so contrast is checked on exact values.

**Required ratios, all reported as actual numbers:**

- every number colour against the revealed surface, 4.5:1 or better, and
  the proof-map ink `--num-proof` against all eight proof bands, 4.5:1 or
  better, in both themes (see "One colour encoding per state" below);
- glyphs (flag, mine, cross) against their cell surface: 3:1 or better;
- the focus indicator against every surface it can sit on: 3:1 or better
  from at least one of its two tones (see the two-tone focus rule below);
- adjacent proof bands must differ visibly, so report the ΔL between
  neighbouring bands.

**Visual concept (decided in phase 3a).** Squared exam paper. Revealed cells
are paper, covered cells are solid slate (the unproven part of the board),
and numbers are ink. On a win, the proof map deepens revealed paper through
eight bands of one ochre hue, from the opening (`--proof-0`, palest) to the
last forced cell (`--proof-7`, deepest), so the board reads as a proof
written out in order. Steps are ordered data, so the bands are a sequential
single-hue ramp with monotonic lightness, never a rainbow. Every band has
OKLab chroma of at most 0.06 so the number hues stay readable on it. In dark,
the bands rise in lightness from the revealed surface. Number hues follow the
Windows order (1 blue, 2 green, 3 red, 4 navy, 5 maroon, 6 teal,
7 near-black, 8 grey); in dark they lighten to pass and keep that order.
Mapping steps to bands is phase 3b's job.

**Token rules (decided in phase 3a).**

- **Hex only.** Every colour value in `styles/tokens.css` is a 6-digit hex
  (`#rrggbb`): no `oklch()`, `rgb()`, `color-mix()` or named colours, so the
  contrast script checks exactly what ships. One token per line.
- **Two identical dark blocks.** Light values live in
  `:root, [data-theme="light"]`. Dark values live in `[data-theme="dark"]`
  and again in
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.
  The two dark blocks must be identical; the script fails if they differ.
  Non-colour tokens (`--cell-size` of at least 44px, `--gap`, `--radius`,
  `--font-ui`, `--font-num`, system stacks only, no web fonts) live in a
  plain `:root` block.
- **Band ΔE.** Band OKLab L must be strictly monotonic from `--proof-0` to
  `--proof-7` (decreasing in light, increasing in dark), and each adjacent
  pair must have an OKLab ΔE of at least 0.03. The script prints L, ΔL and
  ΔE for every pair. The ramp's length was fixed while number colours still
  had to pass on the bands. Since digits on bands now use `--num-proof`,
  that constraint is gone, and the ink has headroom on `--proof-7`.
- **Two-tone focus.** Focus is drawn as a 2px outline in `--focus-ring`
  outside the cell plus a 2px inset box-shadow in `--focus-halo` inside it
  (phase 3b renders both together). Ring against halo must be 3:1 or better,
  and on every surface (`--bg`, `--cell-covered`, `--cell-pressed`,
  `--cell-revealed`, every band, `--cell-mine`, `--cell-detonated`) the
  better of the two must reach 3:1. One tone per theme is dark and the other
  light, so a single colour no longer has to contrast with both the slate and
  the deepest band. (A single-colour ring did, which forced the slate to
  near-black and the ramp to ΔE 0.02.)
- **Slate.** `--cell-covered` is a real slate: in light, OKLCH L 0.45–0.55
  at hue ~250 with low chroma, the lightest value that clears 3:1 against
  `--cell-revealed`. In dark, the equivalent: hue ~250, low chroma, the
  darkest value that clears 3:1 against the dark revealed surface.
- **Covered edge.** `--cell-covered-edge` must be 3:1 or better against
  every band in both themes, so flagged mines on a won board keep a visible
  boundary against the proof map.
- **Number separation.** Fitting every number to the 4.5:1 floor gives them
  equal lightness and collapses the colour convention. So the OKLab ΔE
  between every pair of number colours (all 28 pairs) must be at least 0.08
  in each theme. Numbers may sit well above 4.5:1. In light, 4 (navy) is
  darker than 1 and 5 (maroon) darker than 3. In dark, 4 and 5 are
  separated from 1 and 3 by lightness and chroma, not only hue. Greys (7, 8)
  have OKLab chroma of at most 0.02.
- **One colour encoding per state.** Number hues and proof bands are two
  colour systems. Putting both on one cell forced the numbers to equal
  lightness and collapsed the Windows convention. Bands exist only on a won
  board, when recognising numbers at a glance no longer matters. So while the
  proof map is shown, every digit renders in one neutral ink, `--num-proof`
  (light near-black, dark near-white). `--num-1` to `--num-8` appear only
  on `--cell-revealed` during play and need 4.5:1 there only; their band
  ratios are printed as report-only. `--num-proof` needs 4.5:1 on every
  band.

`scripts/contrast.mjs` checks, per theme, failing on any miss (WCAG 2.x
relative luminance and contrast ratio; OKLab from Björn Ottosson's matrices,
https://bottosson.github.io/posts/oklab/):

1. every `--num-N` on `--cell-revealed`: 4.5 or better (band ratios
   printed, report only); then (1b) the 8×8 OKLab ΔE matrix between numbers,
   every pair 0.08 or more, with the closest pair printed; then (1c)
   `--num-proof` on every band: 4.5 or better;
2. 3 or better for flag and wrong-flag glyphs on `--cell-covered`,
   `--glyph-mine` on `--cell-mine`, and `--glyph-detonated` on
   `--cell-detonated`;
3. `--focus-ring` against `--focus-halo`: 3 or better; and for every
   surface above, max(ring, halo) 3 or better, printing both ratios and which
   tone carries it;
4. `--clue-outline` on `--cell-revealed` and every band: 3 or better;
5. `--cell-covered` on `--cell-revealed`: 3 or better (covered on each band
   is printed, report only);
6. `--cell-covered-edge` on every band: 3 or better;
7. `--text` and `--text-muted` on `--bg`: 4.5 or better;
8. the band L, ΔE (0.03 floor) and chroma rules above;
9. a missing token, a non-hex value, a colour function anywhere in the file,
   or dark blocks that differ.

`docs/tokens-preview.html` is a static review page (tokens.css only, no
script) showing both themes side by side. It is not published.

**Stop.** Print the contrast table. No components yet.

### Phase 3b: Store, persistence, UI, proof map

**Goal:** the playable game.

**Store and persistence tests:**

- A single-cell reveal emits exactly one changed index. A flood emits exactly
  the flooded set.
- An in-progress game saved and loaded round-trips: same cells, same status,
  same elapsed time, and a proof trace equal to the pre-save trace
  (recomputed, not stored).
- Corrupted JSON loads defaults.
- A payload with `version: 99` loads defaults, and the test asserts that
  `setItem` is never called afterwards.
- A storage object whose methods throw still allows a full game.
- A saved payload containing no game loads settings only.

**UI requirements, accessibility inline:**

- The board is a `role="grid"` of rows and gridcells, each cell holding a
  `<button>`. Focus uses a roving tabindex: exactly one cell has
  `tabindex=0`.
- Keyboard:
  - arrow keys move one cell;
  - Home and End go to the row start and end;
  - Ctrl+Home and Ctrl+End go to the first and last cell;
  - Enter or Space reveals a cell, or chords on a number;
  - F toggles a flag.
  - Moving focus calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })`.
- Mouse: primary button reveals or chords; secondary button flags. The
  context menu is prevented on the board only.
- Touch: a visible Flag mode toggle (`<button aria-pressed>`). While it is
  on, a tap flags. Tapping a number chords in either mode. There is no
  long-press.
- Accessible names are 1-based and contextual, for example:
  - "Row 3, column 5, covered"
  - "…, flagged"
  - "…, 2 adjacent mines"
  - "…, empty"
  - after a win: "…, proved at step 4 by subset rule".
- Cells are at least 44×44 px at every board size. The board sits in its own
  `overflow: auto` container. The page itself has no horizontal scroll at
  320 px.
- Meaning never comes from colour alone:
  - numbers are digits;
  - the detonated mine uses a distinct glyph from the other mines;
  - wrong flags show a cross;
  - loss clues get a dashed outline plus a text list;
  - the proof map has a visible inspector line under the board ("Row 2,
    column 3: step 4, subset rule") that updates on focus and hover, a
    visually-hidden table (step, cells opened, rule), and a one-sentence
    takeaway ("Solved in 14 deduction steps; 3 needed the subset rule.").
- A polite live region announces:
  - multi-cell openings ("Opened 23 cells"), but not single-cell reveals,
    because the focused button's name already changes;
  - flag changes ("Flagged. 9 mines left.");
  - the win or loss.
  - The timer is never in a live region.
- On a loss, focus moves to the explanation heading (`tabindex="-1"`). On a
  win, focus moves to the summary heading. Focus never falls to `<body>`.
- Starting a new game while a game has progress beyond the first click opens
  a native `<dialog>` via `showModal()`. Escape closes it, and focus returns
  to the New game button explicitly.
- The timer displays `elapsed(game, now)` and pauses when the document is
  hidden.
- `prefers-reduced-motion` removes the proof-map transition. The final state
  is identical.
- On a win, digits switch from `--num-1`…`--num-8` to `--num-proof` as part
  of the proof-map transition. Under `prefers-reduced-motion` the switch is
  instant.
- Light and dark themes follow `prefers-color-scheme`.

**Dev server (decided in phase 3b).** Module scripts do not load from
`file://`, so every browser check uses `npm run serve`
(`scripts/serve.mjs`): `node:http` only, bound to `127.0.0.1`, port 8080 or
`PORT`. It serves GET and HEAD with explicit MIME types for html, css, js,
mjs and svg, maps `/` to `index.html`, and refuses (403) any path that does
not decode, contains a backslash, null byte or colon, has any segment
starting with `.` (so `..`, `.git` and dotfiles are never served), or
resolves outside the repo root after following symlinks. It is not
published. `.claude/launch.json` is local and gitignored.

**Store (decided in phase 3b).** `createStore({ storage, now, newSeed })`;
`main.js` passes `localStorage`, `performance.now()` and a
`crypto.getRandomValues` seed. API: `getState()` returns
`{ settings, game, flagMode }`; `dispatch(action)` with `reveal`, `flag`,
`chord` (each with `index`), `toggleFlagMode`, `setDifficulty`
(`difficulty`), `newGame`, `pause`, `resume`; `subscribe(fn)` calls
`fn(state, { changed, rebuild, statusChanged })`. `changed` comes straight
from the rules. `newGame` and `setDifficulty` set `rebuild: true`;
`setDifficulty` to the current difficulty is a no-op. A rules no-op (no
changed cells, no clock or status change) keeps the same game object and
emits nothing. The store also has `elapsed()` for the timer, and
`getProof()` and `getLossInfo()`, which build `buildProof` / `explainLoss`
on first read after a win / loss, memoise them on the game object, and are
never persisted. Flag mode is session-only. `hasProgress(game)` (exported)
is true when the game is playing and has a flag or more revealed cells than
the first click's flood alone; New game and a difficulty change ask for
confirmation only then, and the dialog names the action ("Switch to Expert
and abandon this game?").

**Persistence (decided in phase 3b).** Key `"lemma"`, `version: 1`. Payload
`{ version, settings: { difficulty }, game }`, where `game` holds `width`,
`height`, `mineCount`, `seed`, `firstClick`, `status`, `detonated`,
`lossCause`, `lossAction`, `gen`, `cells` (a string of 0/1/2) and
`accumulatedMs` (= `elapsed(game, now)` at save time). Mines, counts,
`resumedAt`, the proof and the loss explanation are never stored.

- `migrate(raw)`: version 1 passes through; a higher integer version is an
  unknown future version (run on defaults in memory, never write); anything
  else is invalid and loads defaults (writes allowed).
- Load regenerates mines by replaying `reveal(newGame(config, seed),
  firstClick, 0)`, the same path as the first reveal including the
  fallback. A loaded `'playing'` game resumes its clock from the load time.
- A game is dropped (settings kept) when: `gen !== GENERATOR_VERSION`; its
  size does not match the saved difficulty's preset; `cells` has the wrong
  length or a character other than 0/1/2; the fields do not fit the status
  (for example `'ready'` with a revealed cell, `'playing'` with its first
  click covered or every safe cell revealed, `'won'` with a covered safe
  cell or an unflagged mine, `'lost'` whose detonated cell is not a
  revealed mine); or, after regenerating, a revealed cell is a mine other
  than the detonated one.
- The store saves after every state-changing dispatch. `pagehide`
  dispatches `pause`, which folds the running time and saves.
- **`GENERATOR_VERSION`** (in `generate.js`, currently 1) must be bumped
  whenever the (config, seed, firstClick) -> mines mapping can change:
  `placeMines`, `generate`, `mulberry32`, `deduce`, `neighbourTable`,
  `buildProof`, `flood`, `neighbours`, `computeCounts`, `GENERATE_CAP`, or
  the first-reveal path in `rules.js`. `test/golden.test.js` ("generator
  output is unchanged; bump GENERATOR_VERSION if this fails") hashes the
  mines for three fixed (seed, firstClick) pairs per difficulty.

**Views (decided in phase 3b).**

- `bandOf(step, maxStep)` in `proof.js`: 0 when `maxStep` is 0, otherwise
  `round(step * 7 / maxStep)`. Cells the proof never reached get no band.
- `cellView` / `cellName` in `src/view/names.js`. States: `covered`,
  `flagged`, `revealed`, `mine`, `detonated`, `wrong-flag`, `safe-shown`.
  Names: "Row r, column c, " then "covered", "flagged", "empty",
  "1 adjacent mine" or "n adjacent mines"; after a win, revealed cells
  append "opened by first click", "opened at step N by cascade", "proved at
  step N by single-clue rule" or "proved at step N by subset rule"; after a
  loss, "mine", "mine, detonated" or "flagged, not a mine".
- **Safe cell after a `'no'` loss:** rendered as revealed paper with its
  digit (`data-state="safe-shown"`), named "..., provably safe, shown after
  loss", and listed in the explanation with its clues, which get the dashed
  outline. A lone paper cell among slate is the covered/revealed pair the
  contrast script already checks at 3:1, so no new token is needed.
- `nextFocus(index, key, ctrlKey, width, height)` in `src/view/keys.js`:
  arrows clamp, Home/End stay in the row, Ctrl+Home/End go to the first and
  last cell, other keys return null. `activationFor(game, index, flagMode)`
  gives `chord` for a revealed cell in either mode, else `flag` in flag
  mode, else `reveal`.
- **Activation runs only on the button's `click` event** (mouse, Enter and
  Space). `keydown` handles only navigation and F. Handling Enter or Space
  in keydown as well would activate twice.
- Glyphs are an inline SVG sprite (`flag`, `mine`, `burst`, `cross`) in
  `currentColor`, inserted with `createElementNS` and `<use>`. The mine is
  a round ball with four orthogonal stubs and the detonated burst is a
  hollow eight-point star, so they differ in shape, not only colour; a test
  checks the sprite. A wrong flag is the flag with the cross over it.
- A game that loads already won or lost shows its result without moving
  focus; focus moves to the heading only when the game ends in this page.
- The confirm dialog returns focus to its trigger: New game, or the checked
  difficulty radio (not the unchecked one that was clicked).
- On a won board digits use `--num-proof`, and `background-color` and
  `color` transition over 400ms with a delay of band x 60ms;
  `prefers-reduced-motion` removes the transition.

**Stop.** Report what was built, the test count, and anything not verified in
a real browser.

### Phase 4: Deploy, CI, README

**Goal:** a public site and a gated pipeline.

- `publish-allowlist.json` classifies every tracked file as `publish` or
  `exclude`. `scripts/allowlist.mjs` fails on any unclassified file and on any
  listed file that doesn't exist. Deploy uploads only the `publish` set, copied
  into a staging directory.
- `ci.yml` runs on pull requests and pushes: `npm ci`, typecheck, tests,
  contrast, and the allowlist check, all failing the build. Node comes from
  `actions/setup-node` with `node-version: lts/*`. Do not pin a remembered
  version number.
- `deploy.yml` runs on push to main, repeats the gates, then uses the Pages
  actions. The Pages source is "GitHub Actions", never "deploy from a
  branch".
- The README covers:
  - what the game is;
  - how the guarantee works;
  - the soundness trade-off (rule 9);
  - the measurement table from phase 2;
  - attribution;
  - a Design notes section. Its draft is provided separately; do not invent
    one.

**Allowlist (decided in phase 4).** `publish-allowlist.json` has exactly two
keys, `publish` and `exclude`, each an array of exact repo-relative paths: no
globs, no leading `/` or `./`, forward slashes only, no duplicates. The
publish set is `index.html`, `styles/tokens.css`, `styles/app.css` and every
`src/**/*.js` the page loads. Everything else tracked is excluded, including
`test/`, `scripts/`, `docs/`, package files, tsconfigs, `CLAUDE.md`,
`README.md`, the dotfiles and `.github/`. `scripts/allowlist.mjs` reads the
tracked files from `git ls-files -z` (`execFileSync`, no shell) and fails,
naming each offender, on:

1. a tracked file that is in neither list;
2. a listed file that does not exist;
3. a file in both lists;
4. a published file that references a local file outside the publish set:
   `./` and `../` import specifiers in JS (static, re-export, side-effect,
   dynamic and JSDoc `import()`), `href`/`src` (and `action`, `formaction`,
   `poster`) in HTML, and `url()`/`@import` in CSS; a reference that climbs
   out of the repo also fails;
5. any root-absolute URL (`/x`, not `//host`) in a published file, because
   Pages serves the site under `/lemma/`. In JS this is any quoted string of
   that form.

`--stage <dir>` copies the publish set into `dir`, preserving paths, only
after every check passes. It refuses, before anything else, a `dir` that
exists and is not an empty directory. The pure checks are exported and
tested in `test/allowlist.test.js`. Any new published file is added to
`publish` in the same change.

**CI and deploy (built in phase 4).** Actions are pinned to major versions
checked with `gh api repos/<owner>/<repo>/releases/latest` on 2026-09-26:
`actions/checkout@v7`, `actions/setup-node@v7`, `actions/configure-pages@v6`,
`actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.

- `.github/workflows/ci.yml`, job `ci`, on `pull_request` and push to `main`,
  `permissions: contents: read`: checkout; setup-node (`lts/*`, npm cache);
  `npm ci`; `npm run typecheck`; `npm test`; `npm run contrast`;
  `npm run allowlist`; and a README gate that fails while `README.md`
  contains `[REWRITE`.
- `.github/workflows/deploy.yml`, on push to `main` and `workflow_dispatch`,
  `permissions: contents: read, pages: write, id-token: write`, concurrency
  group `pages` without cancelling in progress. Job `build` repeats every CI
  gate, runs `node scripts/allowlist.mjs --stage _site`, then
  `configure-pages` and `upload-pages-artifact` with `path: _site`. Job
  `deploy` needs `build`, uses environment `github-pages` with the
  `page_url` output as its URL, and runs `deploy-pages`. Nothing outside
  `_site` is uploaded. `_site/` is gitignored.
- The live site is https://samarth5704.github.io/lemma/. The repository's
  Pages source must be set to "GitHub Actions".

**README (built in phase 4).** Sections, in order: what Lemma is (with the
live URL), how to play, how the guarantee works, the soundness trade-off
(with the 10×2 / 5-mine parity argument), measurement (a fresh
`npm run measure` table with its Node version and CPU), running locally,
project layout, accessibility (what was verified and how), known
limitations, Design notes (the provided draft, verbatim), attribution.

**Stop.** Report the verified action tags, the allowlist output, a dry-run
staging listing, test counts, typecheck and contrast output, files changed,
bugs found with their regression tests, and anything unverified.

## Do not build

Question-mark flags, custom board sizes, best times or leaderboards, sound,
a daily seed, undo, a live hint button, animation beyond the proof-map
transition, a service worker or PWA, canvas rendering, long-press, and custom
panning.

## Stretch goals (only after phase 4 ships)

1. A daily board: the seed derived from the `YYYY-MM-DD` date string, the same
   for everyone.
2. Board generation in a Web Worker, if phone testing shows jank on Expert.
3. 3BV and efficiency (3BV / clicks) on the win summary. 3BV is the community's
   standard difficulty metric; cite it rather than inventing a new one.
4. Best time per difficulty, stored under the same versioned key.
