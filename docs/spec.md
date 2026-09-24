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
- The seeded PRNG is mulberry32. Confirm its author and licence before the
  README cites it; do not cite from memory.

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
src/core/grid.js         dimensions, index<->xy, neighbours
src/core/rng.js          mulberry32(seed) -> () => float in [0,1)
src/core/rules.js        newGame, reveal, flag, chord, status, elapsed, counter
src/core/solver.js       deduce(state) to fixpoint, solveFrom(board, firstClick)
src/core/generate.js     generate(config, firstClick, rng, cap)
src/core/proof.js        trace -> per-cell step, rule, clues; explainLoss()
src/store.js
src/persist.js           load, save, migrate
src/view/grid.js         roving focus, input modes, cell names
src/view/hud.js          counter, timer, flag-mode toggle, difficulty, new game
src/view/result.js       loss explanation, win summary, proof table
src/main.js
test/*.test.js
scripts/measure.mjs      generator attempt/time distribution
scripts/contrast.mjs     WCAG ratio checks from tokens.css, fails on miss
scripts/allowlist.mjs    publish allowlist check, fails on unclassified file
publish-allowlist.json
docs/spec.md             this file
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

`solveFrom(board, firstClick)` simulates play by revealing proven-safe cells
(with flood) until no progress is made. It succeeds when every safe cell is
revealed. Each round records `{ step, rule, cells, clues }`. A cell opened by
flood inherits the step of the reveal that triggered it. Step 0 is the
first-click opening.

`explainLoss(state, clickedIndex)` runs `deduce` on the state just before the
fatal click, without revealing anything new. It returns one of:

- `{ provable: 'mine', clues }` — the clicked cell was provably a mine;
- `{ provable: 'no', safe: index, clues }` — it wasn't provable, but this
  other cell was provably safe.

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
  `solveFrom` from its first click.
- An impossible config (for example, 9×9 with 70 mines) returns
  `{ ok: false }` after exactly `cap` attempts.
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

**Measurement (`scripts/measure.mjs`):** for 500 seeds per difficulty with the
first click at the centre, report attempts per board (median, p95, max) and
generation time in ms (median, p95, max) under Node.

**Stop.** Report the measurement table. Decision rule:

- If Expert p95 is under 150 ms, keep rerolling.
- Otherwise, stop and do not implement perturbation until it has been
  discussed. Phones are slower than the machine that measured, so the
  margin matters.

### Phase 3a: Design tokens: review checkpoint

**Goal:** `styles/tokens.css` for light and dark themes, plus
`scripts/contrast.mjs`, which parses the tokens and fails the process on any
miss.

The tokens cover:

- surfaces for covered, revealed, and pressed cells;
- the eight number colours;
- flag, mine, detonated-mine, and wrong-flag glyph colours;
- the focus ring;
- the loss-clue outline;
- eight discrete proof-map bands, `--proof-0` to `--proof-7`.

Use discrete bands, not `color-mix`, so contrast is checked on exact values.

**Required ratios, all reported as actual numbers:**

- every number colour against every revealed surface, including all eight
  proof bands: 4.5:1 or better, in both themes;
- glyphs (flag, mine, cross) against their cell surface: 3:1 or better;
- the focus ring against both the covered and the revealed surface: 3:1 or
  better;
- adjacent proof bands must differ visibly, so report the ΔL between
  neighbouring bands.

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
- Light and dark themes follow `prefers-color-scheme`.

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
