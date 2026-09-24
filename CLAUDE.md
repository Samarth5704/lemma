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
- `npm run contrast` (from phase 3a)
- `npm run allowlist` (from phase 4)

Test files are not typechecked (would require @types/node); this is deliberate.
