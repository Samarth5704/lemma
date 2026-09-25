# Lemma

No-guess Minesweeper. Full spec: `docs/spec.md`. Re-read it at the start of
every session. Work only on the phase you were asked for, and stop at its stop
point.

## Hard constraints

- Plain JS ES modules, no build step. The only dev dependency is TypeScript,
  used only for `tsc --noEmit` over JSDoc (checkJs). No runtime dependencies.
  No frameworks, bundlers, jsdom, or test libraries.
- Tests use `node:test` with `node:assert/strict`. Write tests before the
  implementation for any logic. Name tests as the specific edge case, not a
  category.
- `src/core/` is pure. No Math.random, Date, performance, crypto,
  localStorage, document, or window. Randomness is an injected `rng`, and time
  is an explicit `now`. A test enforces this, and the core tsconfig has no DOM
  lib.
- `src/core/` holds no module-level mutable state (no top-level `let`, and
  no top-level Map, Set or array), not even caches. A test enforces this.
  Pass derived helpers such as the neighbour table down instead.
- Neighbours come from (x, y) with per-axis bounds checks. Never compute them
  with flat-index offsets.
- Mines are placed after the first click, excluding the clicked cell and its
  neighbours. Never move mines.
- Win means every safe cell is revealed. Flags are never part of the win
  check.
- Flood fill is iterative with a visited set and never opens flags.
- Chord only acts when the flag count equals the number; wrong flags
  detonate.
- The solver is sound. It uses only revealed numbers, ignores flags, and
  ignores the global mine count.
- The solver sees the board only through `visibleClues(game)`: an
  `Int8Array` holding the count on each revealed cell and -1 for every
  covered, flagged or detonated cell. `deduce(width, height, clues)` takes
  nothing else. `visibleClues` is the only place that reads `counts` for the
  solver; never pass mines, counts or flags into deduction. Only post-mortems
  (explainLoss for a chord loss) may read mines.
- The generator has a hard attempt cap and returns `{ ok: false }` when it is
  exhausted.
- Derived values (proof trace, elapsed time, counter) are computed and never
  stored.
- One store owns state and persistence, and views subscribe. The grid updates
  only changed cells. Never use innerHTML for cells or lists.
- Persistence uses one localStorage key, a `version` field, and `migrate()`.
  An unknown future version means run on defaults and never write. All
  storage access goes inside try/catch.

## Accessibility (requirements, not polish)

- Cells are real `<button>`s in a `role="grid"` with a roving tabindex, and
  have contextual names such as "Row 3, column 5, 2 adjacent mines".
- Never convey meaning by colour alone.
- Contrast is verified by `scripts/contrast.mjs`, which reports actual
  ratios.
- Touch targets are at least 44 px. The board scrolls inside its own
  container, and the page has no horizontal scroll at 320 px.
- The timer is never in a live region.
- After a win or loss, focus moves to a deliberate heading, never `<body>`.
- Dialogs close on Escape and restore focus to the trigger.
- `prefers-reduced-motion` removes motion, never information.

## Design tokens (from phase 3a)

- Concept: squared exam paper. Revealed cells are paper, covered cells are
  solid slate, numbers are ink. The win proof map deepens revealed paper
  through eight bands of one ochre hue (`--proof-0` opening, palest, to
  `--proof-7` last forced cell, deepest). A sequential single-hue ramp,
  never a rainbow; band chroma is at most 0.06 (OKLab).
- Every colour in `styles/tokens.css` is a 6-digit hex, one token per line.
  No `oklch()`, `rgb()`, `color-mix()` or named colours.
- Dark values appear twice, in `[data-theme="dark"]` and in the
  `prefers-color-scheme: dark` media block under
  `:root:not([data-theme="light"])`. The two blocks must be identical. Edit
  both together.
- Band OKLab L is strictly monotonic, and adjacent bands differ by an OKLab ΔE
  of at least 0.03.
- Focus is two-tone: a 2px `--focus-ring` outline outside plus a 2px inset
  `--focus-halo` box-shadow inside. Ring vs halo is at least 3:1, and on
  every surface (bg, covered, pressed, revealed, every band, mine,
  detonated) at least one tone reaches 3:1. Never draw focus with one tone.
- `--cell-covered` is a mid slate (hue ~250, low chroma), not near-black.
  `--cell-covered-edge` is at least 3:1 against every band in both themes.
- One colour encoding per state. During play digits use `--num-1` to
  `--num-8`, which need 4.5:1 on `--cell-revealed` only. While the proof
  map is shown, every digit uses the single neutral ink `--num-proof`
  (4.5:1 on every band). Never put number hues on a band.
- Number colours differ from each other by OKLab ΔE of at least 0.08 (all
  28 pairs, per theme). Never fit every number to one contrast floor; that
  makes them equally light and collapses the convention. In light, 4 is
  darker than 1 and 5 darker than 3; in dark, 4 and 5 differ from 1 and 3 in
  lightness and chroma. Greys have chroma of at most 0.02.
- `npm run contrast` enforces all of this and exits 1 on any miss.

## Working rules

- Do not touch files outside the current phase's scope. Do not add
  dependencies.
- If you fix a bug during a session, add a named regression test for it and
  report both.
- Report numbers, not reassurance. "Handled" and "should be fine" are not
  results.
- Say explicitly what you could not verify (for example, anything that needs
  a real browser or device).
- If a decision changes the design, update `docs/spec.md` and this file in
  the same change, and say so.

## Commands

- `npm run typecheck`
- `npm test`
- `npm run measure` (generator attempts and timing; phase 2)
- `npm run contrast` (from phase 3a)
- `npm run allowlist` (from phase 4)

Test files are not typechecked (would require @types/node); this is deliberate.
